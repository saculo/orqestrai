// orq slot: take, keep, free and list verify slots (src/slots.ts).
import { Console, Data, Duration, Effect, Schedule } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Db } from "./db.ts"
import { OrqError, stamp } from "./domain.ts"
import { type Slot, Slots } from "./slots.ts"
import { withState } from "./state.ts"

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))
const until = (s: Slot) => stamp(s.expires_at).slice(0, 16)

/** Every slot of this machine is held: worth waiting for when --wait is given. */
class AllHeld extends Data.TaggedError("AllHeld")<{ readonly held: ReadonlyArray<Slot> }> {}

/** Every 2 seconds for `seconds`, the last try at the limit, never after it. */
const within = (seconds: number) =>
  Schedule.spaced("2 seconds").pipe(
    Schedule.upTo({ duration: Duration.seconds(seconds) }),
    Schedule.modifyDelay(({ duration, elapsed }) =>
      Effect.succeed(Duration.min(duration, Duration.millis(Math.max(0, seconds * 1000 - elapsed)))),
    ),
  )

const take = Command.make(
  "take",
  { id, wait: Flag.Int("wait").pipe(Flag.withDefault(0), Flag.withDescription("seconds to wait for a free slot")) },
  ({ id, wait }) =>
    Effect.gen(function* () {
      const slots = yield* Slots
      const task = yield* (yield* Db).get(id)
      const slot = yield* slots.take(id, task.worktree).pipe(
        Effect.flatMap((r) => ("slot" in r ? Effect.succeed(r.slot) : Effect.fail(new AllHeld({ held: r.busy })))),
        (taking) => (wait > 0 ? Effect.retry(taking, { schedule: within(wait), while: (e) => e._tag === "AllHeld" }) : taking),
        Effect.catchTag("AllHeld", ({ held }) =>
          Effect.fail(
            new OrqError({ message: `no free verify slot; held by ${held.map((s) => `${s.task_id} (until ${until(s)})`).join(", ")}` }),
          ),
        ),
      )
      yield* Console.log(`ORQ_SLOT=${slot.n}\nORQ_PORT_BASE=${slots.portBase(slot)}\nORQ_PROJECT=orq-${id.toLowerCase()}`)
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
      yield* Console.log(`slot ${s.n} kept for ${id} until ${until(s)}, port ${port}; orq slot free ${id} stops it`)
    }),
).pipe(Command.withDescription("keep the app up after verify, for the user's manual checks"), withState)

const free = Command.make("free", { id }, ({ id }) =>
  Effect.gen(function* () {
    const s = yield* (yield* Slots).free(id)
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
