// orq slot: take, keep, free and list verify slots (src/slots.ts).
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"
import { type Slot, Slots } from "./slots.ts"

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))
const until = (s: Slot) => new Date(s.expires_at).toISOString().slice(0, 16).replace("T", " ")

const take = Command.make(
  "take",
  { id, wait: Flag.Int("wait").pipe(Flag.withDefault(0), Flag.withDescription("seconds to wait for a free slot")) },
  ({ id, wait }) =>
    Effect.gen(function* () {
      const slots = yield* Slots
      const task = yield* (yield* Db).get(id)
      const deadline = Date.now() + wait * 1000
      for (;;) {
        const r = yield* slots.take(id, task.worktree)
        if ("slot" in r) {
          yield* Console.log(`ORQ_SLOT=${r.slot.n}\nORQ_PORT_BASE=${slots.portBase(r.slot)}\nORQ_PROJECT=orq-${id.toLowerCase()}`)
          return
        }
        if (Date.now() >= deadline) {
          const held = r.busy.map((s) => `${s.task_id} (until ${until(s)})`).join(", ")
          return yield* new OrqError({ message: `no free verify slot; held by ${held}` })
        }
        yield* Effect.sleep("2 seconds")
      }
    }),
).pipe(Command.withDescription("take a verify slot: prints ORQ_SLOT, ORQ_PORT_BASE, ORQ_PROJECT"))

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
).pipe(Command.withDescription("keep the app up after verify, for the user's manual checks"))

const free = Command.make("free", { id }, ({ id }) =>
  Effect.gen(function* () {
    const s = yield* (yield* Slots).free(id)
    yield* Console.log(s ? `freed slot ${s.n}${s.stop ? " and stopped the app" : ""}` : `${id} holds no slot`)
  }),
).pipe(Command.withDescription("free the task's slot; stops a kept app"))

const ls = Command.make("ls", {}, () =>
  Effect.gen(function* () {
    for (const s of yield* (yield* Slots).list)
      yield* Console.log(`slot ${s.n}  ${s.task_id}  until ${until(s)}${s.kept ? `  kept, port ${s.port}` : ""}`)
  }),
).pipe(Command.withDescription("verify slots in use"))

export const slot = Command.make("slot").pipe(
  Command.withDescription("verify slots: one running app per slot"),
  Command.withSubcommands([take, keep, free, ls]),
)
