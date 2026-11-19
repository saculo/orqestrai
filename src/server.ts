// `orq serve`: the one process that connects to the database. Clients (the CLI) call its
// HTTP API (src/api.ts) and never hold the password. On the VPS it runs as its own user and
// listens on a Unix socket, so file permissions decide who may call it (DESIGN.md, Security).
// The handlers only touch the database; the server never runs a command.
import { resolve } from "node:path"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { OrqApi } from "./api.ts"
import { dashboard, enterPageDir, PAGE } from "./dashboard.ts"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"
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
      setState: ({ params, payload }) => db.setState(params.id, payload.step, payload.status, payload.note, payload.message),
      events: ({ params, query }) => db.events(params.id, query.limit),
      link: ({ params, payload }) => db.link(params.id, payload.kind, payload.ref, payload.role),
      links: ({ params }) => db.links(params.id),
      findLink: ({ query }) => db.findLink(query.kind, query.ref),
      setPlaybook: ({ params, payload }) => db.setType(params.id, payload.playbook),
      fileSums: ({ params }) => db.fileSums(params.id),
      putFiles: ({ params, payload }) => db.putFiles(params.id, payload.put, payload.keep),
      file: ({ params, query }) => db.file(params.id, query.path),
    })
  }),
)

/** Where the server listens: a Unix socket path, or a TCP address and port. */
export type Listen = { readonly unix: string } | { readonly host: string; readonly port: number }

const serveApi = (listen: Listen) =>
  HttpRouter.serve(Layer.mergeAll(HttpApiBuilder.layer(OrqApi).pipe(Layer.provide(tasks)), dashboard), { disableLogger: true }).pipe(
    Layer.provide(
      BunHttpServer.layer({
        ...("unix" in listen ? { unix: listen.unix } : { hostname: listen.host, port: listen.port }),
        // the dashboard's page, bundled once by Bun; every other path goes to the API
        routes: PAGE,
        development: false,
      }),
    ),
  )

export const serve = Command.make(
  "serve",
  {
    socket: Flag.String("socket").pipe(Flag.optional, Flag.withDescription("listen on this Unix socket")),
    port: Flag.Int("port").pipe(Flag.optional, Flag.withDescription("listen on this TCP port")),
    host: Flag.String("host").pipe(
      Flag.withDefault("127.0.0.1"),
      Flag.withDescription("with --port: the address to listen on"),
    ),
  },
  ({ socket, port, host }) => {
    // both at once: the sessions on the socket, a browser (the dashboard) on the port
    const listens: Array<Listen> = [
      ...Option.toArray(Option.map(socket, (unix) => ({ unix: resolve(unix) }))),
      ...Option.toArray(Option.map(port, (port) => ({ host, port }))),
    ]
    if (listens.length === 0) return Effect.fail(new OrqError({ message: "orq serve needs --socket <path>, --port <n> or both" }))
    return Effect.gen(function* () {
      yield* Db // opens the state file while relative paths still mean what they meant
      enterPageDir()
      yield* Effect.all(
        listens.map((l) => Layer.launch(serveApi(l))),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.mapError((e) => new OrqError({ message: `orq serve: ${e.message}` })))
    })
  },
).pipe(Command.withDescription("serve orq's state over HTTP, and the dashboard at /"), Command.provide(Direct))
