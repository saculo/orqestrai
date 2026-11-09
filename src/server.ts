// `orq serve`: the one process that connects to the database. Clients (the CLI, `orq mcp`) call its
// HTTP API (src/api.ts) and never hold the password. On the VPS it runs as its own user and
// listens on a Unix socket, so file permissions decide who may call it (DESIGN.md, Security).
// The handlers only touch the database; the server never runs a command.
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { OrqApi } from "./api.ts"
import { Db } from "./db.ts"
import { Slots } from "./slots.ts"

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
    })
  }),
)

const slots = HttpApiBuilder.group(
  OrqApi,
  "slots",
  Effect.fnUntraced(function* (handlers) {
    const slots = yield* Slots
    return handlers.handleAll({
      take: ({ params, payload }) => slots.take(params.id, payload.worktree),
      keep: ({ params, payload }) => slots.keep(params.id, payload.stop, payload.port),
      free: ({ params }) => slots.free(params.id).pipe(Effect.map((s) => s ?? null)),
      list: () => slots.list,
    })
  }),
)

/** Where the server listens: a Unix socket path, or a TCP address and port. */
export type Listen = { readonly unix: string } | { readonly host: string; readonly port: number }

export const serveApi = (listen: Listen) =>
  HttpRouter.serve(HttpApiBuilder.layer(OrqApi).pipe(Layer.provide([tasks, slots])), { disableLogger: true }).pipe(
    Layer.provide(BunHttpServer.layer("unix" in listen ? { unix: listen.unix } : { hostname: listen.host, port: listen.port })),
  )
