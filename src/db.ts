// The index of tasks in Postgres (src/pg.ts). Content lives in Markdown and git; this is only the index.
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { type LinkRole, OrqError, type Status, type Step, Task, TaskEvent, TaskLink, taskId } from "./domain.ts"
import { asOrqError, rows } from "./pg.ts"

export interface NewTask {
  readonly id: string
  readonly repo: string
  readonly title: string
  readonly branch: string
  readonly worktree: string
  readonly note: string
}

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
      const sql = yield* SqlClient

      const addEvent = (id: string, kind: string, detail: string) => sql`INSERT INTO events ${sql.insert({ task_id: id, kind, detail })}`

      /** Locks the task's row for the rest of the transaction; fails when there is no such task. */
      const lockTask = (id: string) =>
        Effect.gen(function* () {
          const found = yield* sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`
          if (found.length === 0) return yield* noTask(id)
        })

      const get = (id: string) =>
        sql`SELECT * FROM tasks WHERE id = ${id}`.pipe(
          Effect.flatMap(rows(Task)),
          Effect.flatMap(([task]) => (task ? Effect.succeed(task) : Effect.fail(noTask(id)))),
          asOrqError("get"),
        )

      const create = (build: (id: string) => NewTask) =>
        Effect.gen(function* () {
          yield* sql`LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE`
          const [next] = yield* sql<{ n: number }>`SELECT coalesce(max(substr(id, 3)::int), 0) + 1 AS n FROM tasks`
          const task = build(taskId(next?.n ?? 1))
          const { note, ...row } = task
          yield* sql`INSERT INTO tasks ${sql.insert(row)}`
          yield* addEvent(task.id, "created", note)
          return task
        }).pipe(sql.withTransaction, asOrqError("create"))

      const setState = (id: string, step: Step, status: Status, note: string) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          yield* sql`UPDATE tasks SET ${sql.update({ step, status })}, updated_at = now() WHERE id = ${id}`
          yield* addEvent(id, `${step}: ${status}`, note)
        }).pipe(sql.withTransaction, asOrqError("set state"))

      const link = (id: string, kind: string, ref: string, role: LinkRole) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          yield* sql`INSERT INTO task_links ${sql.insert({ task_id: id, kind, ref, role })}
                     ON CONFLICT (task_id, kind, ref) DO UPDATE SET role = EXCLUDED.role`
          yield* addEvent(id, "linked", `${kind} ${ref} (${role})`)
        }).pipe(sql.withTransaction, asOrqError("link"))

      return {
        create,
        remove: (id) => sql`DELETE FROM tasks WHERE id = ${id}`.pipe(Effect.asVoid, asOrqError("remove")),
        get,
        setState,
        list: sql`SELECT * FROM tasks ORDER BY id`.pipe(Effect.flatMap(rows(Task)), asOrqError("list")),
        events: (id, limit) =>
          sql`SELECT at, kind, detail FROM events WHERE task_id = ${id} ORDER BY seq DESC LIMIT ${limit}`.pipe(
            Effect.flatMap(rows(TaskEvent)),
            asOrqError("events"),
          ),
        link,
        links: (id) =>
          sql`SELECT kind, ref, role FROM task_links WHERE task_id = ${id} ORDER BY seq`.pipe(
            Effect.flatMap(rows(TaskLink)),
            asOrqError("links"),
          ),
      }
    }),
  )
}
