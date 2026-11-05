// Verify slots: a lock on this machine's room to run an app. A task takes a slot before verify
// starts its app, and gets a port range and a compose project name. orq keeps only the lock;
// how the app starts and stops is the verify-<surface> skill's job. A slot expires, so a
// crashed session cannot hold it forever: the next take stops that app and frees it.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { OrqConfig } from "./config.ts"
import { OrqError } from "./domain.ts"
import { run } from "./proc.ts"

export interface Slot {
  readonly n: number
  readonly task_id: string
  readonly worktree: string
  readonly expires_at: number
  /** 1 when the app stays up after verify, for the user's manual checks */
  readonly kept: number
  readonly stop: string | null
  readonly port: number | null
}

export type Taken = { readonly slot: Slot } | { readonly busy: ReadonlyArray<Slot> }

const SCHEMA = `CREATE TABLE IF NOT EXISTS slots(
  n INTEGER PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, worktree TEXT NOT NULL,
  expires_at INTEGER NOT NULL, kept INTEGER NOT NULL DEFAULT 0, stop TEXT, port INTEGER)`

const attempt = <A>(what: string, f: () => A) =>
  Effect.try({ try: f, catch: (e) => new OrqError({ message: `slots: ${what}: ${String(e)}` }) })

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
      const db = yield* Effect.acquireRelease(
        attempt("open", () => {
          mkdirSync(cfg.home, { recursive: true })
          const d = new Database(join(cfg.home, "state.db"), { create: true, strict: true })
          d.exec("PRAGMA busy_timeout = 10000")
          d.exec(SCHEMA)
          return d
        }),
        (d) => Effect.sync(() => d.close()),
      )
      const byTask = (task: string) => db.query("SELECT * FROM slots WHERE task_id = $task").get({ task }) as Slot | null
      const expiry = () => Date.now() + cfg.slotTtl * 1000

      /** Stops a slot's app (if verify kept it up) and stops serving its port. Errors are reported, not fatal. */
      const release = (s: Slot) =>
        Effect.gen(function* () {
          if (s.stop) yield* sh(s.stop, s.worktree)
          if (s.port && cfg.unserve) yield* sh(cfg.unserve.replaceAll("{port}", String(s.port)))
        })

      const take = (task: string, worktree: string) =>
        Effect.gen(function* () {
          const result = yield* attempt("take", () =>
            db
              .transaction(() => {
                const expired = db.query("SELECT * FROM slots WHERE expires_at < $now").all({ now: Date.now() }) as Slot[]
                db.query("DELETE FROM slots WHERE expires_at < $now").run({ now: Date.now() })
                const mine = byTask(task)
                if (mine) {
                  db.query("UPDATE slots SET expires_at = $at WHERE task_id = $task").run({ at: expiry(), task })
                  return { expired, taken: { slot: byTask(task) as Slot } as Taken }
                }
                const used = new Set((db.query("SELECT n FROM slots").all() as { n: number }[]).map((r) => r.n))
                const n = Array.from({ length: cfg.slots }, (_, i) => i + 1).find((i) => !used.has(i))
                if (n === undefined)
                  return { expired, taken: { busy: db.query("SELECT * FROM slots ORDER BY n").all() as Slot[] } as Taken }
                db.query("INSERT INTO slots(n, task_id, worktree, expires_at) VALUES($n, $task, $worktree, $at)").run({
                  n,
                  task,
                  worktree,
                  at: expiry(),
                })
                return { expired, taken: { slot: byTask(task) as Slot } as Taken }
              })
              .immediate(),
          )
          yield* Effect.forEach(result.expired, release, { discard: true })
          return result.taken
        })

      const keep = (task: string, stop: string, port: number) =>
        Effect.gen(function* () {
          const s = yield* attempt("keep", () => {
            db.query("UPDATE slots SET kept = 1, stop = $stop, port = $port, expires_at = $at WHERE task_id = $task").run({
              task,
              stop,
              port,
              at: expiry(),
            })
            return byTask(task)
          })
          if (!s) return yield* Effect.fail(new OrqError({ message: `${task} holds no slot; take one first` }))
          if (cfg.serve) yield* sh(cfg.serve.replaceAll("{port}", String(port)))
          return s
        })

      const free = (task: string) =>
        Effect.gen(function* () {
          const s = yield* attempt("free", () => byTask(task))
          if (!s) return undefined
          yield* release(s)
          yield* attempt("free", () => db.query("DELETE FROM slots WHERE task_id = $task").run({ task }))
          return s
        })

      return {
        take,
        keep,
        free,
        list: attempt("list", () => db.query("SELECT * FROM slots ORDER BY n").all() as Slot[]),
        portBase: (s: Slot) => cfg.portStart + (s.n - 1) * 100,
      }
    }),
  )
}
