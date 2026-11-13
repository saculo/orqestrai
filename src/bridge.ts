// `orq bridge`: Slack ⇄ the task sessions, on the sessions' machine, outside the sandbox. No LLM.
//   @bot <request> in a project's channel → a new task (`orq new`), its tab, one thread for it.
//   your reply in that thread           → typed into the task's session (reopened if closed).
//   `orq ask` from a session            → posted in the task's thread, over a local socket.
// The Slack tokens are read from a file the sandbox hides, never from the environment, so the
// zellij session it may start (and every task session in it) does not inherit them.
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Config, Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"
import { baseBranch } from "./git.ts"
import { listen, post, type Slack, type SlackEvent } from "./slack.ts"
import { withState } from "./state.ts"
import { startTask } from "./task.ts"
import { ensureSession, sendToTask } from "./zellij.ts"

const settings = Config.all({
  /** SLACK_APP_TOKEN=xapp-… and SLACK_BOT_TOKEN=xoxb-… lines; hidden from the sandbox (Fence) */
  tokens: Config.String("ORQ_SLACK_TOKENS").pipe(Config.withDefault(join(homedir(), ".config", "orq-bridge", "slack.env"))),
  /** your Slack member id: the bridge listens to nobody else */
  user: Config.String("ORQ_SLACK_USER"),
  /** each project's channel and checkout: C0123=/home/orq/projects/app,C0456=… */
  channels: Config.String("ORQ_SLACK_CHANNELS"),
  api: Config.String("ORQ_SLACK_API").pipe(Config.withDefault("https://slack.com/api")),
})

const readTokens = (file: string) =>
  Effect.try({
    try: () =>
      Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .map((l) => l.trim().split(/=(.*)/s, 2) as [string, string]),
      ),
    catch: () => new OrqError({ message: `orq bridge: cannot read ${file}` }),
  }).pipe(
    Effect.flatMap((t) =>
      t.SLACK_APP_TOKEN && t.SLACK_BOT_TOKEN
        ? Effect.succeed({ appToken: t.SLACK_APP_TOKEN, botToken: t.SLACK_BOT_TOKEN })
        : Effect.fail(new OrqError({ message: `orq bridge: ${file} needs SLACK_APP_TOKEN= and SLACK_BOT_TOKEN= lines` })),
    ),
  )

const parseChannels = (spec: string) =>
  new Map(
    spec
      .split(",")
      .map((pair) => pair.trim().split("=", 2) as [string, string])
      .filter(([c, p]) => c && p),
  )

/** The request without the bot's mention. */
const request = (text: string | undefined) => (text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim()

const threadRef = (channel: string, ts: string) => `${channel}/${ts}`

/** The question `orq ask` sends to the bridge's socket. */
export const Ask = Schema.Struct({ id: Schema.String, text: Schema.String })

const bridge = Command.make("bridge", {}, () =>
  Effect.gen(function* () {
    const { user, channels: spec, api, tokens } = yield* settings
    const slack: Slack = { api, ...(yield* readTokens(tokens)) }
    const channels = parseChannels(spec)
    const channelOf = (repo: string) => [...channels].find(([, path]) => path === repo)?.[0]
    const { bridge: socket } = yield* OrqConfig
    const db = yield* Db
    yield* ensureSession

    const reportTo = (channel: string, thread: string) => (e: OrqError) =>
      Console.error(`orq bridge: ${e.message}`).pipe(Effect.andThen(post(slack, channel, `orq: ${e.message}`, thread)), Effect.ignore)

    const newTask = (e: SlackEvent) =>
      Effect.gen(function* () {
        const root = channels.get(e.channel)
        if (root === undefined) return yield* new OrqError({ message: `this channel is no project's (ORQ_SLACK_CHANNELS)` })
        const { task, tab } = yield* startTask(root, request(e.text))
        yield* db.link(task.id, "slack-thread", threadRef(e.channel, e.ts), "origin")
        yield* post(slack, e.channel, `${task.id} started: \`${task.branch}\`. ${tab.split("\n")[0]}`, e.ts)
      }).pipe(Effect.catch(reportTo(e.channel, e.ts)))

    const reply = (e: SlackEvent, thread: string) =>
      Effect.gen(function* () {
        const id = yield* db.findLink("slack-thread", threadRef(e.channel, thread))
        if (id === null) return
        const task = yield* db.get(id)
        yield* Console.log(`${id}: ${yield* sendToTask(id, task.worktree, yield* baseBranch(task.repo), request(e.text))}`)
      }).pipe(Effect.catch(reportTo(e.channel, thread)))

    /** Your top-level mention starts a task; your message in a task's thread answers it. A
     * mention inside a thread arrives as a message too, so only the message is used. */
    const onEvent = (e: SlackEvent) => {
      if (e.user !== user || e.bot_id || e.subtype) return Effect.void
      if (e.type === "app_mention" && e.thread_ts === undefined) return newTask(e)
      if (e.type === "message" && e.thread_ts !== undefined && e.thread_ts !== e.ts) return reply(e, e.thread_ts)
      return Effect.void
    }

    const ask = ({ id, text }: typeof Ask.Type) =>
      Effect.gen(function* () {
        const task = yield* db.get(id)
        let ref = (yield* db.links(id)).find((l) => l.kind === "slack-thread")?.ref
        if (ref === undefined) {
          // a task started in a terminal gets its thread at its first question
          const channel = channelOf(task.repo)
          if (channel === undefined) return yield* new OrqError({ message: `no Slack channel for ${task.repo} (ORQ_SLACK_CHANNELS)` })
          ref = threadRef(channel, yield* post(slack, channel, `${id}: ${task.title}`))
          yield* db.link(id, "slack-thread", ref, "related")
        }
        const [channel = "", thread] = ref.split("/", 2)
        yield* post(slack, channel, `<@${user}> ${text}`, thread)
      })

    const services = yield* Effect.context<Db | OrqConfig | ChildProcessSpawner>()
    const run = Effect.runPromiseWith(services)
    const runFork = Effect.runForkWith(services)

    if (existsSync(socket)) rmSync(socket)
    const server = Bun.serve({
      unix: socket,
      fetch: async (req) => {
        const body = Schema.decodeUnknownOption(Ask)(await req.json().catch(() => null))
        if (body._tag === "None") return new Response("want {id, text}", { status: 400 })
        return run(
          ask(body.value).pipe(
            Effect.as(new Response("posted")),
            Effect.catch((e) => Effect.succeed(new Response(e.message, { status: 422 }))),
          ),
        )
      },
    })
    chmodSync(socket, 0o600)
    yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
    yield* Console.log(`orq bridge: listening to Slack; questions on ${socket}; projects: ${[...channels.values()].join(", ")}`)
    return yield* listen(slack, (e) => void runFork(onEvent(e)))
  }).pipe(Effect.scoped),
).pipe(Command.withDescription("Slack ⇄ task sessions: new tasks, your answers, their questions (ORQ_SLACK_*)"), withState)

export { bridge }
