// orq slot: take, keep, free and list verify slots (src/slots.ts). The slot is a lock in the
// database; starting, stopping and serving the app run here, as the session's user.
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { OrqConfig } from "./config.ts"
import { stamp } from "./domain.ts"
import { run } from "./proc.ts"
import { type Slot, Slots, takeSlot } from "./slots.ts"
import { withState } from "./state.ts"

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))
const until = (s: Slot) => stamp(s.expires_at).slice(0, 16)

/** Runs a shell command and returns whether it succeeded. A failure is a warning that names the
 * command to run by hand, not an error: a stop that fails must not block the next task. */
const sh = (cmd: string, cwd?: string) =>
  run("sh", ["-c", cmd], cwd).pipe(
    Effect.map((out) => (out.code === 0 ? "" : out.stderr.trim() || `exit ${out.code}`)),
    Effect.orElseSucceed(() => "cannot start sh"),
    Effect.flatMap((failure) =>
      failure
        ? Console.error(`orq: warning: \`${cmd}\`${cwd ? ` in ${cwd}` : ""} failed: ${failure}; run it yourself`).pipe(Effect.as(false))
        : Effect.succeed(true),
    ),
  )
const withPort = (cmd: string, port: number) => cmd.replaceAll("{port}", String(port))

/** Stops a freed slot's app (if verify kept it up) and stops serving its port. Returns whether
 * the app was stopped. */
const release = Effect.fnUntraced(function* (s: Slot) {
  const { unserve } = yield* OrqConfig
  const stopped = s.stop ? yield* sh(s.stop, s.worktree) : false
  if (s.port && unserve) yield* sh(withPort(unserve, s.port))
  return stopped
})

/** Frees the task's slot and stops its app. Returns the freed slot, if it held one, and whether
 * its app was stopped. */
export const freeSlot = Effect.fnUntraced(function* (id: string) {
  const slot = yield* (yield* Slots).free(id)
  return slot ? { slot, stopped: yield* release(slot) } : undefined
})

const take = Command.make(
  "take",
  { id, wait: Flag.Int("wait").pipe(Flag.withDefault(0), Flag.withDescription("seconds to wait for a free slot")) },
  ({ id, wait }) =>
    Effect.gen(function* () {
      const { slot, expired, portBase, project } = yield* takeSlot(id, wait)
      yield* Effect.forEach(expired, release, { discard: true })
      yield* Console.log(`ORQ_SLOT=${slot.n}\nORQ_PORT_BASE=${portBase}\nORQ_PROJECT=${project}`)
    }),
).pipe(Command.withDescription("take a verify slot: prints ORQ_SLOT, ORQ_PORT_BASE, ORQ_PROJECT"), withState)

const keep = Command.make(
  "keep",
  {
    id,
    stop: Flag.String("stop").pipe(Flag.withDescription("the command that stops the app, run in the worktree")),
    port: Flag.Int("port").pipe(Flag.withDescription("the port the user opens")),
  },
  ({ id, stop, port }) =>
    Effect.gen(function* () {
      const s = yield* (yield* Slots).keep(id, stop, port)
      const { serve } = yield* OrqConfig
      const served = serve ? yield* sh(withPort(serve, port)) : true
      yield* Console.log(
        `slot ${s.n} kept for ${id} until ${until(s)}, port ${port}${served ? "" : " (not served)"}; orq slot free ${id} stops it`,
      )
    }),
).pipe(Command.withDescription("keep the app up after verify, for the user's manual checks"), withState)

const free = Command.make("free", { id }, ({ id }) =>
  Effect.gen(function* () {
    const freed = yield* freeSlot(id)
    yield* Console.log(freed ? `freed slot ${freed.slot.n}${freed.stopped ? " and stopped the app" : ""}` : `${id} holds no slot`)
  }),
).pipe(Command.withDescription("free the task's slot; stops a kept app"), withState)

const ls = Command.make("ls", {}, () =>
  Effect.gen(function* () {
    const { host } = yield* OrqConfig
    for (const s of yield* (yield* Slots).list(host))
      yield* Console.log(`slot ${s.n}  ${s.task_id}  until ${until(s)}${s.kept ? `  kept, port ${s.port}` : ""}`)
  }),
).pipe(Command.withDescription("verify slots in use"), withState)

export const slot = Command.make("slot").pipe(
  Command.withDescription("verify slots: one running app per slot"),
  Command.withSubcommands([take, keep, free, ls]),
)
