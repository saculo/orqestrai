// The index of tasks in Postgres (src/pg.ts). Content lives in Markdown and git; this is only the index.
import type { SQL } from "bun"
import { Context, Effect, Layer } from "effect"
import { type LinkRole, OrqError, type Status, type Step, type Task, type TaskEvent, type TaskLink, taskId } from "./domain.ts"
import { Pg, stamp } from "./pg.ts"

export interface NewTask {
  readonly id: string
  readonly repo: string
  readonly title: string
  readonly branch: string
  readonly worktree: string
  readonly note: string
}

type Row = Omit<Task, "created_at" | "updated_at"> & { created_at: Date; updated_at: Date }
const toTask = (r: Row): Task => ({ ...r, created_at: stamp(r.created_at), updated_at: stamp(r.updated_at) })
const noTask = (id: string) => new OrqError({ message: `no task ${id}` })

export class Db extends Context.Service<
  Db,
  {
    /** Gives the next id and inserts the task in one transaction, so two runs never share an id. */
    readonly create: (build: (id: string) => NewTask) => Effect.Effect<NewTask, OrqError>
    /** Removes a task that could not be set up. */
    readonly remove: (id: string) => Effect.Effect<void, OrqError>
    readonly get: (id: string) => Effect.Effect<Task, OrqError>
    readonly setState: (id: string, step: Step, status: Status, note: string) => Effect.Effect<void, OrqError>
    readonly list: Effect.Effect<ReadonlyArray<Task>, OrqError>
    readonly events: (id: string, limit: number) => Effect.Effect<ReadonlyArray<TaskEvent>, OrqError>
    readonly link: (id: string, kind: string, ref: string, role: LinkRole) => Effect.Effect<void, OrqError>
    readonly links: (id: string) => Effect.Effect<ReadonlyArray<TaskLink>, OrqError>
  }
>()("orq/Db") {
  static readonly layer = Layer.effect(
    Db,
    Effect.gen(function* () {
      const { run } = yield* Pg

      /** Runs f in a transaction; false from f means the task does not exist. */
      const onTask = (what: string, id: string, f: (tx: SQL) => Promise<boolean>) =>
        run(what, (sql) => sql.begin(f)).pipe(Effect.flatMap((found) => (found ? Effect.void : Effect.fail(noTask(id)))))

      return {
        create: (build) =>
          run("create", (sql) =>
            sql.begin(async (tx) => {
              await tx`LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE`
              const [{ n }] = await tx`SELECT coalesce(max(substr(id, 3)::int), 0) + 1 AS n FROM tasks`
              const t = build(taskId(n))
              await tx`INSERT INTO tasks(id, repo, title, branch, worktree)
                       VALUES(${t.id}, ${t.repo}, ${t.title}, ${t.branch}, ${t.worktree})`
              await tx`INSERT INTO events(task_id, kind, detail) VALUES(${t.id}, 'created', ${t.note})`
              return t
            }),
          ),
        remove: (id) => run("remove", (sql) => sql`DELETE FROM tasks WHERE id = ${id}`).pipe(Effect.asVoid),
        get: (id) =>
          run("get", (sql) => sql`SELECT * FROM tasks WHERE id = ${id}`).pipe(
            Effect.flatMap(([r]) => (r ? Effect.succeed(toTask(r)) : Effect.fail(noTask(id)))),
          ),
        setState: (id, step, status, note) =>
          onTask("set state", id, async (tx) => {
            const updated = await tx`UPDATE tasks SET step = ${step}, status = ${status}, updated_at = now() WHERE id = ${id} RETURNING id`
            if (!updated.length) return false
            await tx`INSERT INTO events(task_id, kind, detail) VALUES(${id}, ${`${step}: ${status}`}, ${note})`
            return true
          }),
        list: run("list", (sql) => sql`SELECT * FROM tasks ORDER BY id`).pipe(Effect.map((rs: Row[]) => rs.map(toTask))),
        events: (id, limit) =>
          run("events", (sql) => sql`SELECT at, kind, detail FROM events WHERE task_id = ${id} ORDER BY seq DESC LIMIT ${limit}`).pipe(
            Effect.map((rs: { at: Date; kind: string; detail: string | null }[]) => rs.map((e) => ({ ...e, at: stamp(e.at) }))),
          ),
        link: (id, kind, ref, role) =>
          onTask("link", id, async (tx) => {
            const [task] = await tx`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`
            if (!task) return false
            await tx`INSERT INTO task_links(task_id, kind, ref, role) VALUES(${id}, ${kind}, ${ref}, ${role})
                     ON CONFLICT (task_id, kind, ref) DO UPDATE SET role = EXCLUDED.role`
            await tx`INSERT INTO events(task_id, kind, detail) VALUES(${id}, 'linked', ${`${kind} ${ref} (${role})`})`
            return true
          }),
        links: (id) => run("links", (sql) => sql`SELECT kind, ref, role FROM task_links WHERE task_id = ${id} ORDER BY seq`),
      }
    }),
  )
}
