// orq-server: the one process that opens the state file when the CLI runs on other machines.
// The CLI calls its HTTP API (core's api.ts) with ORQ_SERVER set. It listens on a Unix socket, a
// TCP port, or both; it serves the dashboard at / too. The handlers only touch the database;
// the server never runs a command.
import { resolve } from "node:path"
import { BunHttpServer } from "@effect/platform-bun"
import { OrqApi } from "@orqestrai/core/api.ts"
import { Db } from "@orqestrai/core/db.ts"
import { OrqError } from "@orqestrai/core/domain.ts"
import { Direct } from "@orqestrai/core/state.ts"
import { Effect, Layer, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { dashboard, enterPageDir, PAGE } from "./dashboard.ts"
import { addIssue, Starts, startsRoute } from "./starts.ts"
import { trigger } from "./trigger.ts"

const tasks = HttpApiBuilder.group(
  OrqApi,
  "tasks",
  Effect.fnUntraced(function* (handlers) {
    const db = yield* Db
    const add = addIssue(db, yield* Starts)
    return handlers.handleAll({
      create: ({ payload }) => db.create(payload),
      start: ({ params, payload }) => db.start(params.id, payload.repo, payload.worktree),
      unstart: ({ params, payload }) => db.unstart(params.id, payload.worktree),
      addFromIssue: ({ payload }) => add(payload),
      remove: ({ params }) => db.remove(params.id),
      get: ({ params }) => db.get(params.id),
      list: () => db.list,
      setState: ({ params, payload }) => db.setState(params.id, payload.step, payload.status, payload.note, payload.message),
      events: ({ params, query }) => db.events(params.id, query.limit),
      link: ({ params, payload }) => db.link(params.id, payload.kind, payload.ref, payload.role),
      links: ({ params }) => db.links(params.id),
      findLink: ({ query }) => db.findLink(query.kind, query.ref),
      setPlaybook: ({ params, payload }) => db.setType(params.id, payload.playbook),
      now: ({ params }) => db.now(params.id),
      fileSums: ({ params }) => db.fileSums(params.id),
      putFiles: ({ params, payload }) => db.putFiles(params.id, payload.put, payload.keep),
      file: ({ params, query }) => db.file(params.id, query.path),
    })
  }),
)

/** Where the server listens: a Unix socket path, or a TCP address and port. */
export type Listen = { readonly unix: string } | { readonly host: string; readonly port: number }

const serveApi = (listen: Listen) =>
  HttpRouter.serve(Layer.mergeAll(HttpApiBuilder.layer(OrqApi).pipe(Layer.provide(tasks)), dashboard, startsRoute), {
    disableLogger: true,
  }).pipe(
    Layer.provide(
      BunHttpServer.layer({
        ...("unix" in listen ? { unix: listen.unix } : { hostname: listen.host, port: listen.port }),
        // the dashboard's page, bundled once by Bun; every other path goes to the API
        routes: PAGE,
        development: false,
      }),
    ),
  )

/** The trigger endpoint, alone on its port: no API, no dashboard. */
const serveTrigger = (host: string, port: number, token: string) =>
  HttpRouter.serve(trigger(token), { disableLogger: true }).pipe(Layer.provide(BunHttpServer.layer({ hostname: host, port })))

export const server = Command.make(
  "orq-server",
  {
    socket: Flag.String("socket").pipe(Flag.optional, Flag.withDescription("listen on this Unix socket")),
    port: Flag.Int("port").pipe(Flag.optional, Flag.withDescription("listen on this TCP port")),
    triggerPort: Flag.Int("trigger-port").pipe(
      Flag.optional,
      Flag.withDescription("serve the trigger endpoint (POST /github/issues, needs ORQ_TRIGGER_TOKEN) on this TCP port"),
    ),
    host: Flag.String("host").pipe(
      Flag.withDefault("127.0.0.1"),
      Flag.withDescription("with --port or --trigger-port: the address to listen on"),
    ),
  },
  ({ socket, port, host, triggerPort }) => {
    // both at once: the sessions on the socket, a browser (the dashboard) on the port
    const listens: Array<Listen> = [
      ...Option.toArray(Option.map(socket, (unix) => ({ unix: resolve(unix) }))),
      ...Option.toArray(Option.map(port, (port) => ({ host, port }))),
    ]
    if (listens.length === 0) return Effect.fail(new OrqError({ message: "orq-server needs --socket <path>, --port <n> or both" }))
    const token = process.env.ORQ_TRIGGER_TOKEN ?? ""
    if (Option.isSome(triggerPort) && token === "")
      return Effect.fail(new OrqError({ message: "orq-server --trigger-port needs ORQ_TRIGGER_TOKEN" }))
    const triggers = Option.toArray(Option.map(triggerPort, (p) => serveTrigger(host, p, token)))
    return Effect.gen(function* () {
      yield* Db // opens the state file while relative paths still mean what they meant
      enterPageDir()
      yield* Effect.all(
        [...listens.map(serveApi), ...triggers].map((l) => Layer.launch(l)),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.mapError((e) => new OrqError({ message: `orq-server: ${e.message}` })))
    })
  },
).pipe(
  Command.withDescription("orqestrai's state over HTTP, for the CLI on other machines, and the dashboard at /"),
  Command.provide(Starts.layer.pipe(Layer.provideMerge(Direct))),
)
