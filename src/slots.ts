// Verify slots: a lock on this machine's room to run an app. Slots are per host ($ORQ_HOST)
// in the shared database. A task takes a slot before verify
// starts its app, and gets a port range and a compose project name. orq keeps only the lock;
// how the app starts and stops is the verify-<surface> skill's job. A slot expires, so a
// crashed session cannot hold it forever: the next take stops that app and frees it.
import type { SQL } from "bun"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { OrqConfig } from "./config.ts"
import { OrqError } from "./domain.ts"
import { Pg } from "./pg.ts"
import { run } from "./proc.ts"

export interface Slot {
  readonly n: number
  readonly task_id: string
  readonly worktree: string
  readonly expires_at: Date
  /** true when the app stays up after verify, for the user's manual checks */
  readonly kept: boolean
  readonly stop: string | null
  readonly port: number | null
}

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
      const pg = yield* Pg
      const host = cfg.host
      const ttl = cfg.slotTtl
      const byTask = async (sql: SQL, task: string) => ((await sql`SELECT * FROM slots WHERE task_id = ${task}`) as Slot[])[0]

      /** Stops a slot's app (if verify kept it up) and stops serving its port. Errors are reported, not fatal. */
      const release = (s: Slot) =>
        Effect.gen(function* () {
          if (s.stop) yield* sh(s.stop, s.worktree)
          if (s.port && cfg.unserve) yield* sh(cfg.unserve.replaceAll("{port}", String(s.port)))
        })

      const take = (task: string, worktree: string) =>
        Effect.gen(function* () {
          const result = yield* pg.run("take", (sql) =>
            sql.begin(async (tx) => {
              await tx`LOCK TABLE slots IN SHARE ROW EXCLUSIVE MODE`
              const expired: Slot[] = await tx`DELETE FROM slots WHERE host = ${host} AND expires_at < now() RETURNING *`
              const extended: Slot[] = await tx`UPDATE slots SET expires_at = now() + make_interval(secs => ${ttl})
                                                WHERE task_id = ${task} RETURNING *`
              if (extended[0]) return { expired, taken: { slot: extended[0] } as Taken }
              const used = new Set(((await tx`SELECT n FROM slots WHERE host = ${host}`) as { n: number }[]).map((r) => r.n))
              const n = Array.from({ length: cfg.slots }, (_, i) => i + 1).find((i) => !used.has(i))
              if (n === undefined)
                return { expired, taken: { busy: await tx`SELECT * FROM slots WHERE host = ${host} ORDER BY n` } as Taken }
              const [slot] = await tx`INSERT INTO slots(host, n, task_id, worktree, expires_at)
                                      VALUES(${host}, ${n}, ${task}, ${worktree}, now() + make_interval(secs => ${ttl})) RETURNING *`
              return { expired, taken: { slot } as Taken }
            }),
          )
          yield* Effect.forEach(result.expired, release, { discard: true })
          return result.taken
        })

      const keep = (task: string, stop: string, port: number) =>
        Effect.gen(function* () {
          const [s] = yield* pg.run(
            "keep",
            (sql) =>
              sql`UPDATE slots SET kept = true, stop = ${stop}, port = ${port}, expires_at = now() + make_interval(secs => ${ttl})
                         WHERE task_id = ${task} RETURNING *` as Promise<Slot[]>,
          )
          if (!s) return yield* Effect.fail(new OrqError({ message: `${task} holds no slot; take one first` }))
          if (cfg.serve) yield* sh(cfg.serve.replaceAll("{port}", String(port)))
          return s
        })

      const free = (task: string) =>
        Effect.gen(function* () {
          const s = yield* pg.run("free", (sql) => byTask(sql, task))
          if (!s) return undefined
          yield* release(s)
          yield* pg.run("free", (sql) => sql`DELETE FROM slots WHERE task_id = ${task}`)
          return s
        })

      return {
        take,
        keep,
        free,
        list: pg.run("list", (sql) => sql`SELECT * FROM slots WHERE host = ${host} ORDER BY n` as Promise<Slot[]>),
        portBase: (s: Slot) => cfg.portStart + (s.n - 1) * 100,
      }
    }),
  )
}
