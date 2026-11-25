// `orq watch`: keeps the server's start stream (GET /starts, Server-Sent Events) open and starts
// each task it names, one at a time, as `orq start` does. The server sends the waiting tasks at
// connect and each new one after; a stream that ends or goes quiet is opened again.
import { OrqError } from "@orqestrai/core/domain.ts"
import { Config, Console, Duration, Effect } from "effect"
import { Command } from "effect/cli"
import { startTask } from "./task.ts"
import { withState } from "./with-state.ts"

/** The server sends a ping every 15 s; no data for this long is a dropped line. */
const QUIET_MS = 45_000

const settings = Config.all({
  server: Config.String("ORQ_SERVER").pipe(Config.option),
  retry: Config.Number("ORQ_WATCH_RETRY").pipe(Config.withDefault(2)),
})

const open = (server: string) =>
  Effect.tryPromise({
    try: async () => {
      const socket = server.startsWith("/")
      const url = `${socket ? "http://orq" : server.replace(/\/+$/, "")}/starts`
      const res = await fetch(url, { ...(socket ? { unix: server } : {}) } as RequestInit)
      if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`)
      return res.body.getReader()
    },
    catch: (e) => new OrqError({ message: `orq server: ${e instanceof Error ? e.message : String(e)}` }),
  })

/** Starts one task. Already started (another watcher, the user, a duplicate id) is skipped quietly. */
const startOne = (id: string) =>
  startTask(id).pipe(
    Effect.flatMap(({ task, session }) => Console.log(`${task.id}  ${session.message}`)),
    Effect.catch((e) => (e.message.includes("is already started") ? Effect.void : Console.error(`orq watch: ${id}: ${e.message}`))),
  )

/** The ids of the events in `buffer`, and what is left of it. */
const events = (buffer: string) => {
  const parts = buffer.split("\n\n")
  const rest = parts.pop() ?? ""
  return { ids: parts.filter((p) => p.startsWith("data: ")).map((p) => p.slice(6).trim()), rest }
}

const follow = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.gen(function* () {
    const text = new TextDecoder()
    let buffer = ""
    for (;;) {
      const chunk = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (e) => new OrqError({ message: String(e) }),
      }).pipe(Effect.timeout(Duration.millis(QUIET_MS)))
      if (chunk.done) return
      const { ids, rest } = events(buffer + text.decode(chunk.value, { stream: true }))
      buffer = rest
      for (const id of ids) yield* startOne(id)
    }
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))))

export const watch = Command.make("watch", {}, () =>
  Effect.gen(function* () {
    const { server, retry } = yield* settings
    if (server._tag === "None")
      return yield* new OrqError({ message: "orq watch needs a server (server in the settings file, or ORQ_SERVER)" })
    yield* Console.log(`watching ${server.value} for tasks to start`)
    for (;;) {
      yield* open(server.value).pipe(
        Effect.flatMap(follow),
        Effect.catch(() => Effect.void),
      )
      yield* Effect.sleep(Duration.seconds(retry))
    }
  }),
).pipe(Command.withDescription("start each GitHub backlog task as the server names it; reconnects, runs until stopped"), withState)
