// Verify slots: a lock on this machine's room to run an app. Slots are per host ($ORQ_HOST) in
// the shared database. A task takes a slot before verify starts its app, and gets a port range
// and a compose project name. orq keeps only the lock;
// how the app starts and stops is the verify-<surface> skill's job. A slot expires, so a
// crashed session cannot hold it forever: the next take stops that app and frees it.
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { SqlClient } from "effect/sql/SqlClient"
import { OrqConfig } from "./config.ts"
import { OrqError } from "./domain.ts"
import { asOrqError, rows } from "./pg.ts"
import { run } from "./proc.ts"

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

export type Taken = { readonly slot: Slot } | { readonly busy: ReadonlyArray<Slot> }

export class Slots extends Context.Service<
  Slots,
  {
    readonly take: (task: string, worktree: string) => Effect.Effect<Taken, OrqError>
    readonly keep: (task: string, stop: string, port: number) => Effect.Effect<Slot, OrqError>
    readonly free: (task: string) => Effect.Effect<Slot | undefined, OrqError>
    readonly list: Effect.Effect<ReadonlyArray<Slot>, OrqError>
    readonly portBase: (slot: Slot) => number
  }
>()("orq/Slots") {
  static readonly layer = Layer.effect(
    Slots,
    Effect.gen(function* () {
      const cfg = yield* OrqConfig
      const spawner = yield* ChildProcessSpawner
      const sh = (cmd: string, cwd?: string) =>
        run("sh", ["-c", cmd], cwd).pipe(Effect.ignore, Effect.provideService(ChildProcessSpawner, spawner))
      const sql = yield* SqlClient
      const host = cfg.host
      const until = sql`now() + make_interval(secs => ${cfg.slotTtl})`
      const slots = rows(Slot)
      const ofHost = sql`SELECT * FROM slots WHERE host = ${host} ORDER BY n`.pipe(Effect.flatMap(slots))

      /** Stops a slot's app (if verify kept it up) and stops serving its port. Errors are reported, not fatal. */
      const release = (s: Slot) =>
        Effect.gen(function* () {
          if (s.stop) yield* sh(s.stop, s.worktree)
          if (s.port && cfg.unserve) yield* sh(cfg.unserve.replaceAll("{port}", String(s.port)))
        })

      const take = (task: string, worktree: string) =>
        Effect.gen(function* () {
          const { expired, taken } = yield* Effect.gen(function* () {
            yield* sql`LOCK TABLE slots IN SHARE ROW EXCLUSIVE MODE`
            const expired = yield* sql`DELETE FROM slots WHERE host = ${host} AND expires_at < now() RETURNING *`.pipe(
              Effect.flatMap(slots),
            )
            const [mine] = yield* sql`UPDATE slots SET expires_at = ${until} WHERE task_id = ${task} RETURNING *`.pipe(
              Effect.flatMap(slots),
            )
            if (mine) return { expired, taken: { slot: mine } as Taken }
            const used = new Set((yield* ofHost).map((s) => s.n))
            const n = Array.from({ length: cfg.slots }, (_, i) => i + 1).find((i) => !used.has(i))
            if (n === undefined) return { expired, taken: { busy: yield* ofHost } as Taken }
            const [slot] = yield* sql`INSERT INTO slots (host, n, task_id, worktree, expires_at)
                                      VALUES (${host}, ${n}, ${task}, ${worktree}, ${until}) RETURNING *`.pipe(Effect.flatMap(slots))
            return { expired, taken: { slot } as Taken }
          }).pipe(sql.withTransaction, asOrqError("take"))
          yield* Effect.forEach(expired, release, { discard: true })
          return taken
        })

      const keep = (task: string, stop: string, port: number) =>
        Effect.gen(function* () {
          const [s] = yield* sql`UPDATE slots SET kept = true, stop = ${stop}, port = ${port}, expires_at = ${until}
                                 WHERE task_id = ${task} RETURNING *`.pipe(Effect.flatMap(slots), asOrqError("keep"))
          if (!s) return yield* new OrqError({ message: `${task} holds no slot; take one first` })
          if (cfg.serve) yield* sh(cfg.serve.replaceAll("{port}", String(port)))
          return s
        })

      const free = (task: string) =>
        Effect.gen(function* () {
          const [s] = yield* sql`SELECT * FROM slots WHERE task_id = ${task}`.pipe(Effect.flatMap(slots), asOrqError("free"))
          if (!s) return undefined
          yield* release(s)
          yield* sql`DELETE FROM slots WHERE task_id = ${task}`.pipe(asOrqError("free"))
          return s
        })

      return {
        take,
        keep,
        free,
        list: ofHost.pipe(asOrqError("list")),
        portBase: (s: Slot) => cfg.portStart + (s.n - 1) * 100,
      }
    }),
  )
}
