// Slack for the bridge: the Web API (post a message) and Socket Mode (events over a WebSocket the
// bridge opens, so no port is open). No SDK: two calls and one socket.
// https://docs.slack.dev/apis/events-api/using-socket-mode
import { Console, Effect, Schedule, Schema } from "effect"
import { OrqError } from "./domain.ts"

export interface Slack {
  /** Web API base, https://slack.com/api; a fake one in tests */
  readonly api: string
  /** xapp-…: opens the Socket Mode connection */
  readonly appToken: string
  /** xoxb-…: posts as the bot */
  readonly botToken: string
}

/** The fields of a message or app_mention event the bridge reads. */
export const SlackEvent = Schema.Struct({
  type: Schema.String,
  user: Schema.optional(Schema.String),
  bot_id: Schema.optional(Schema.String),
  subtype: Schema.optional(Schema.String),
  channel: Schema.String,
  ts: Schema.String,
  thread_ts: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
})
export type SlackEvent = typeof SlackEvent.Type

const Envelope = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    envelope_id: Schema.optional(Schema.String),
    payload: Schema.optional(Schema.Struct({ event_id: Schema.optional(Schema.String), event: Schema.optional(Schema.Unknown) })),
  }),
)
const decodeEnvelope = Schema.decodeUnknownOption(Envelope)
const decodeEvent = Schema.decodeUnknownOption(SlackEvent)

const call = (slack: Slack, token: string, method: string, body: object) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${slack.api}/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      })
      return (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown }
    },
    catch: (e) => new OrqError({ message: `slack ${method}: ${e instanceof Error ? e.message : String(e)}` }),
  }).pipe(
    Effect.flatMap((r) => (r.ok ? Effect.succeed(r) : Effect.fail(new OrqError({ message: `slack ${method}: ${r.error ?? "not ok"}` })))),
  )

/** Posts a message, in a thread when `thread` is set; gives back its ts. */
export const post = (slack: Slack, channel: string, text: string, thread?: string) =>
  call(slack, slack.botToken, "chat.postMessage", { channel, text, ...(thread === undefined ? {} : { thread_ts: thread }) }).pipe(
    Effect.map((r) => String(r.ts)),
  )

/** One Socket Mode connection, until Slack or the network closes it. Every envelope is
 * acknowledged at once (Slack sends it again after 3 s otherwise); each event once. */
const connectOnce = (url: string, onEvent: (event: SlackEvent) => void, seen: Set<string>) =>
  Effect.callback<void>((resume) => {
    const ws = new WebSocket(url)
    ws.onmessage = (m) => {
      const envelope = decodeEnvelope(String(m.data))
      if (envelope._tag === "None") return
      const { type, envelope_id, payload } = envelope.value
      if (envelope_id) ws.send(JSON.stringify({ envelope_id }))
      if (type === "disconnect") return ws.close()
      if (type !== "events_api" || !payload) return
      if (payload.event_id) {
        if (seen.has(payload.event_id)) return
        seen.add(payload.event_id)
        if (seen.size > 1000) seen.delete(seen.values().next().value as string)
      }
      const event = decodeEvent(payload.event)
      if (event._tag === "Some") onEvent(event.value)
    }
    ws.onclose = () => resume(Effect.void)
    return Effect.sync(() => ws.close())
  })

/** Events from Slack, forever: it connects again after every close or failure. */
export const listen = (slack: Slack, onEvent: (event: SlackEvent) => void) => {
  const seen = new Set<string>()
  return call(slack, slack.appToken, "apps.connections.open", {}).pipe(
    Effect.flatMap((r) => connectOnce(String(r.url), onEvent, seen)),
    Effect.catch((e) => Console.error(`orq bridge: ${e.message}`)),
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.repeat(Schedule.forever),
  )
}
