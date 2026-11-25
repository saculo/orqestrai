// The start stream: GET /starts, Server-Sent Events. `orq watch` keeps it open and starts each
// task it names. On connect it names every GitHub task not yet started (status TODO); then each
// GitHub task added later. One in-process notifier (Starts) is shared by the routes that add
// tasks and by the stream. The server only names ids; it never runs a command.
import { Db } from "@orqestrai/core/db.ts"
import { Context, Effect, Layer, PubSub, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

const PING_SECONDS = 15

export class Starts extends Context.Service<
  Starts,
  {
    /** Tells the open streams that this GitHub task is waiting to be started. */
    readonly announce: (id: string) => Effect.Effect<void>
    /** The ids to start: those waiting now, then each announced after. A duplicate is possible. */
    readonly ids: Stream.Stream<string, never>
  }
>()("orq/Starts") {
  static readonly layer = Layer.effect(
    Starts,
    Effect.gen(function* () {
      const db = yield* Db
      const pubsub = yield* PubSub.unbounded<string>()
      const waiting = db.list.pipe(
        Effect.map((all) => all.filter((t) => t.worktree === null && t.status === "TODO" && t.source === "github").map((t) => t.id)),
        Effect.orElseSucceed((): Array<string> => []),
      )
      // subscribe first, then read the list: a task added in between is in both, never in neither
      const ids = Stream.unwrap(
        Effect.gen(function* () {
          const sub = yield* PubSub.subscribe(pubsub)
          const now = yield* waiting
          return Stream.concat(Stream.fromIterable(now), Stream.fromSubscription(sub))
        }),
      )
      return { announce: (id) => PubSub.publish(pubsub, id).pipe(Effect.asVoid), ids }
    }),
  )
}

/** Adds a GitHub issue as a backlog task and, when it is new, tells the watchers. */
export const addIssue = (db: Db["Service"], starts: Starts["Service"]) => (issue: Parameters<Db["Service"]["addFromIssue"]>[0]) =>
  db.addFromIssue(issue).pipe(Effect.tap((done) => (done.added ? starts.announce(done.id) : Effect.void)))

export const startsRoute = Layer.unwrap(
  Effect.gen(function* () {
    const { ids } = yield* Starts
    const events = ids.pipe(Stream.map((id) => `data: ${id}\n\n`))
    const pings = Stream.tick(`${PING_SECONDS} seconds`).pipe(Stream.map(() => ": ping\n\n"))
    const body = Stream.merge(events, pings).pipe(Stream.encodeText)
    return HttpRouter.add(
      "GET",
      "/starts",
      Effect.sync(() =>
        HttpServerResponse.stream(body, {
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
        }),
      ),
    )
  }),
)
