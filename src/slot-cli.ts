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

/** Runs a shell command; a failure is ignored, as a stop that fails must not block the next task. */
const sh = (cmd: string, cwd?: string) => run("sh", ["-c", cmd], cwd).pipe(Effect.ignore)
const withPort = (cmd: string, port: number) => cmd.replaceAll("{port}", String(port))

/** Stops a freed slot's app (if verify kept it up) and stops serving its port. */
const release = Effect.fnUntraced(function* (s: Slot) {
  const { unserve } = yield* OrqConfig
  if (s.stop) yield* sh(s.stop, s.worktree)
  if (s.port && unserve) yield* sh(withPort(unserve, s.port))
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
      if (serve) yield* sh(withPort(serve, port))
      yield* Console.log(`slot ${s.n} kept for ${id} until ${until(s)}, port ${port}; orq slot free ${id} stops it`)
    }),
).pipe(Command.withDescription("keep the app up after verify, for the user's manual checks"), withState)

const free = Command.make("free", { id }, ({ id }) =>
  Effect.gen(function* () {
    const s = yield* (yield* Slots).free(id)
    if (s) yield* release(s)
    yield* Console.log(s ? `freed slot ${s.n}${s.stop ? " and stopped the app" : ""}` : `${id} holds no slot`)
  }),
).pipe(Command.withDescription("free the task's slot; stops a kept app"), withState)

const ls = Command.make("ls", {}, () =>
  Effect.gen(function* () {
    for (const s of yield* (yield* Slots).list)
      yield* Console.log(`slot ${s.n}  ${s.task_id}  until ${until(s)}${s.kept ? `  kept, port ${s.port}` : ""}`)
  }),
).pipe(Command.withDescription("verify slots in use"), withState)

export const slot = Command.make("slot").pipe(
  Command.withDescription("verify slots: one running app per slot"),
  Command.withSubcommands([take, keep, free, ls]),
)
