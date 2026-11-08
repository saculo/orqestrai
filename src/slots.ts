// Verify slots: a lock on this machine's room to run an app. Slots are per host ($ORQ_HOST) in
// the shared database. A task takes a slot before verify starts its app, and gets a port range
// and a compose project name. orq keeps only the lock;
// how the app starts and stops is the verify-<surface> skill's job. A slot expires, so a
// crashed session cannot hold it forever: the next take frees it and hands back its app to stop.
// This service only touches the database: it also runs inside `orq serve`, which must never run
// a command. Stopping and serving apps is the caller's job (src/slot-cli.ts).
import { Context, Data, Effect, Layer, Schedule, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { OrqError, stamp } from "./domain.ts"
import { asOrqError, rows } from "./pg.ts"

export const Slot = Schema.Struct({
  n: Schema.Int,
  task_id: Schema.String,
  worktree: Schema.String,
  expires_at: Schema.Date,
  /** true when the app stays up after verify, for the user's manual checks */
  kept: Schema.Boolean,
  stop: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Int),
})
export type Slot = typeof Slot.Type

/** The slot taken with its first port, or the slots that hold every place; and the expired
 * slots freed on the way, whose apps the caller stops. */
export const Taken = Schema.Union([
  Schema.Struct({ slot: Slot, portBase: Schema.Int, expired: Schema.Array(Slot) }),
  Schema.Struct({ busy: Schema.Array(Slot), expired: Schema.Array(Slot) }),
])
export type Taken = typeof Taken.Type

export class Slots extends Context.Service<
  Slots,
  {
    readonly take: (task: string, worktree: string) => Effect.Effect<Taken, OrqError>
    readonly keep: (task: string, stop: string, port: number) => Effect.Effect<Slot, OrqError>
    /** Frees the task's slot and returns it, so the caller can stop its app. */
    readonly free: (task: string) => Effect.Effect<Slot | undefined, OrqError>
    readonly list: Effect.Effect<ReadonlyArray<Slot>, OrqError>
  }
>()("orq/Slots") {
  static readonly layer = Layer.effect(
    Slots,
    Effect.gen(function* () {
      const cfg = yield* OrqConfig
      const sql = yield* SqlClient
      const host = cfg.host
      const until = sql`now() + make_interval(secs => ${cfg.slotTtl})`
      const slots = rows(Slot)
      const portBase = (s: Slot) => cfg.portStart + (s.n - 1) * 100
      const ofHost = sql`SELECT * FROM slots WHERE host = ${host} ORDER BY n`.pipe(Effect.flatMap(slots))

      const take = (task: string, worktree: string) =>
        Effect.gen(function* () {
          yield* sql`LOCK TABLE slots IN SHARE ROW EXCLUSIVE MODE`
          const expired = yield* sql`DELETE FROM slots WHERE host = ${host} AND expires_at < now() RETURNING *`.pipe(Effect.flatMap(slots))
          const [mine] = yield* sql`UPDATE slots SET expires_at = ${until} WHERE task_id = ${task} RETURNING *`.pipe(Effect.flatMap(slots))
          if (mine) return { slot: mine, portBase: portBase(mine), expired } satisfies Taken
          const used = new Set((yield* ofHost).map((s) => s.n))
          const n = Array.from({ length: cfg.slots }, (_, i) => i + 1).find((i) => !used.has(i))
          if (n === undefined) return { busy: yield* ofHost, expired } satisfies Taken
          const [slot] = yield* sql`INSERT INTO slots (host, n, task_id, worktree, expires_at)
                                    VALUES (${host}, ${n}, ${task}, ${worktree}, ${until}) RETURNING *`.pipe(Effect.flatMap(slots))
          if (!slot) return yield* new OrqError({ message: "database: take: no row returned" })
          return { slot, portBase: portBase(slot), expired } satisfies Taken
        }).pipe(sql.withTransaction, asOrqError("take"))

      const keep = (task: string, stop: string, port: number) =>
        Effect.gen(function* () {
          const [s] = yield* sql`UPDATE slots SET kept = true, stop = ${stop}, port = ${port}, expires_at = ${until}
                                 WHERE task_id = ${task} RETURNING *`.pipe(Effect.flatMap(slots), asOrqError("keep"))
          if (!s) return yield* new OrqError({ message: `${task} holds no slot; take one first` })
          return s
        })

      const free = (task: string) =>
        sql`DELETE FROM slots WHERE task_id = ${task} RETURNING *`.pipe(
          Effect.flatMap(slots),
          Effect.map(([s]) => s),
          asOrqError("free"),
        )

      return {
        take,
        keep,
        free,
        list: ofHost.pipe(asOrqError("list")),
      }
    }),
  )
}

/** Every slot of this machine is held: worth waiting for. */
class AllHeld extends Data.TaggedError("AllHeld")<{ readonly held: ReadonlyArray<Slot> }> {}

const until = (s: Slot) => stamp(s.expires_at).slice(0, 16)

/** Takes a slot for the task, waiting up to `wait` seconds while every slot is held. Returns the
 * slot and every expired slot freed on the way, whose apps the caller stops. */
export const takeSlot = Effect.fnUntraced(function* (id: string, wait: number) {
  const slots = yield* Slots
  const task = yield* (yield* Db).get(id)
  const expired: Array<Slot> = []
  const { slot, portBase } = yield* slots.take(id, task.worktree).pipe(
    Effect.tap((r) => Effect.sync(() => expired.push(...r.expired))),
    Effect.flatMap((r) => ("slot" in r ? Effect.succeed(r) : Effect.fail(new AllHeld({ held: r.busy })))),
    Effect.retry({
      schedule: Schedule.spaced("2 seconds").pipe(Schedule.upTo({ duration: `${wait} seconds` })),
      while: (e) => e._tag === "AllHeld",
    }),
    Effect.catchTag("AllHeld", ({ held }) =>
      Effect.fail(
        new OrqError({ message: `no free verify slot; held by ${held.map((s) => `${s.task_id} (until ${until(s)})`).join(", ")}` }),
      ),
    ),
  )
  return { slot, expired, portBase, project: `orq-${id.toLowerCase()}` }
})
