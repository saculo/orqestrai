// `orq serve`: the one process that connects to the database. Clients (the CLI) call its
// HTTP API (src/api.ts) and never hold the password. On the VPS it runs as its own user and
// listens on a Unix socket, so file permissions decide who may call it (DESIGN.md, Security).
// The handlers only touch the database; the server never runs a command.
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { OrqApi } from "./api.ts"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"
import { Slots } from "./slots.ts"
import { Direct } from "./state.ts"

const tasks = HttpApiBuilder.group(
  OrqApi,
  "tasks",
  Effect.fnUntraced(function* (handlers) {
    const db = yield* Db
    return handlers.handleAll({
      create: ({ payload }) => db.create(payload),
      remove: ({ params }) => db.remove(params.id),
      get: ({ params }) => db.get(params.id),
      list: () => db.list,
      setState: ({ params, payload }) => db.setState(params.id, payload.step, payload.status, payload.note),
      events: ({ params, query }) => db.events(params.id, query.limit),
      link: ({ params, payload }) => db.link(params.id, payload.kind, payload.ref, payload.role),
      links: ({ params }) => db.links(params.id),
      findLink: ({ query }) => db.findLink(query.kind, query.ref),
    })
  }),
)

const slots = HttpApiBuilder.group(
  OrqApi,
  "slots",
  Effect.fnUntraced(function* (handlers) {
    const slots = yield* Slots
    return handlers.handleAll({
      take: ({ params, payload }) => slots.take(payload.host, params.id, payload.worktree),
      keep: ({ params, payload }) => slots.keep(params.id, payload.stop, payload.port),
      free: ({ params }) => slots.free(params.id).pipe(Effect.map((s) => s ?? null)),
      list: ({ query }) => slots.list(query.host),
    })
  }),
)

/** Where the server listens: a Unix socket path, or a TCP address and port. */
export type Listen = { readonly unix: string } | { readonly host: string; readonly port: number }

const serveApi = (listen: Listen) =>
  HttpRouter.serve(HttpApiBuilder.layer(OrqApi).pipe(Layer.provide([tasks, slots])), { disableLogger: true }).pipe(
    Layer.provide(BunHttpServer.layer("unix" in listen ? { unix: listen.unix } : { hostname: listen.host, port: listen.port })),
  )

export const serve = Command.make(
  "serve",
  {
    socket: Flag.String("socket").pipe(Flag.optional, Flag.withDescription("listen on this Unix socket")),
    port: Flag.Int("port").pipe(Flag.optional, Flag.withDescription("listen on this TCP port")),
    host: Flag.String("host").pipe(
      Flag.withDefault("127.0.0.1"),
      Flag.withDescription("with --port: the address to listen on, such as the server's private (Tailscale) address"),
    ),
  },
  ({ socket, port, host }) => {
    const listen: Option.Option<Listen> = Option.isSome(socket)
      ? Option.some({ unix: socket.value })
      : Option.map(port, (port) => ({ host, port }))
    return Option.isSome(listen)
      ? Layer.launch(serveApi(listen.value)).pipe(Effect.mapError((e) => new OrqError({ message: `orq serve: ${e.message}` })))
      : Effect.fail(new OrqError({ message: "orq serve needs --socket <path> or --port <n>" }))
  },
).pipe(Command.withDescription("serve orq's state over HTTP; the one process that needs the database password"), Command.provide(Direct))
