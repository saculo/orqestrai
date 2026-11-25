// The index of tasks in SQLite (src/sqlite.ts). Content lives in Markdown and git; the database
// keeps the index, and a copy of each task's files for the dashboard (putFiles).
import { createHash } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import {
  FileSum,
  isTaskFilePath,
  type LinkRole,
  MAX_FILE_BYTES,
  MAX_IMAGES,
  type NewTask,
  OrqError,
  type Status,
  type Step,
  slugify,
  Task,
  TaskEvent,
  TaskLink,
  type TaskNow,
  taskId,
} from "./domain.ts"
import { asOrqError, rows } from "./sqlite.ts"

const noTask = (id: string) => new OrqError({ message: `no task ${id}` })

export class Db extends Context.Service<
  Db,
  {
    /** Gives the next id and inserts the task in one transaction, so two runs never share an id.
     * The branch is `orq/<id>-<slug>`; the task has no worktree until `start`. */
    readonly create: (task: NewTask) => Effect.Effect<Task, OrqError>
    /** Records where the task's checkout is (`repo`, `worktree`), once: fails when it is started already. */
    readonly start: (id: string, repo: string, worktree: string) => Effect.Effect<void, OrqError>
    /** Undoes `start` when the setup after it failed: the worktree goes back to null, only where it is `worktree`. */
    readonly unstart: (id: string, worktree: string) => Effect.Effect<void, OrqError>
    /** Adds a backlog task for a GitHub issue, once per url: the same url gives the same id, added false.
     * The request is the task's REQUEST.md. */
    readonly addFromIssue: (issue: {
      readonly repo: string
      readonly url: string
      readonly title: string
      readonly request: string
    }) => Effect.Effect<{ readonly id: string; readonly added: boolean }, OrqError>
    /** Removes a task that could not be set up. */
    readonly remove: (id: string) => Effect.Effect<void, OrqError>
    readonly get: (id: string) => Effect.Effect<Task, OrqError>
    /** With `message`, the whole message the session sent the user (`orq ask`), as its own event. */
    readonly setState: (id: string, step: Step, status: Status, note: string, message?: string) => Effect.Effect<void, OrqError>
    readonly list: Effect.Effect<ReadonlyArray<Task>, OrqError>
    readonly events: (id: string, limit: number) => Effect.Effect<ReadonlyArray<TaskEvent>, OrqError>
    readonly link: (id: string, kind: string, ref: string, role: LinkRole) => Effect.Effect<void, OrqError>
    readonly links: (id: string) => Effect.Effect<ReadonlyArray<TaskLink>, OrqError>
    /** The task linked to this outside reference, if any (the newest, if several). */
    readonly findLink: (kind: string, ref: string) => Effect.Effect<string | null, OrqError>
    /** Records the task's type: the playbook it runs. */
    readonly setType: (id: string, type: string) => Effect.Effect<void, OrqError>
    /** The task's files the database has a copy of, with their SHA-256. */
    readonly fileSums: (id: string) => Effect.Effect<ReadonlyArray<FileSum>, OrqError>
    /** Stores `put` and forgets every other copy not in `keep`: the folder as it is now, when
     * `put` holds what changed and `keep` what did not. Only task files and evidence images. */
    readonly putFiles: (
      id: string,
      put: ReadonlyArray<{ readonly path: string; readonly content: Uint8Array }>,
      keep: ReadonlyArray<string>,
    ) => Effect.Effect<void, OrqError>
    /** The task's last state note, and the message it was asked with, if that is still current. */
    readonly now: (id: string) => Effect.Effect<TaskNow, OrqError>
    /** One file's copy. */
    readonly file: (id: string, path: string) => Effect.Effect<Uint8Array, OrqError>
  }
>()("orq/Db") {
  static readonly layer = Layer.effect(
    Db,
    Effect.gen(function* () {
      const sql = yield* SqlClient

      const addEvent = (id: string, kind: string, detail: string) => sql`INSERT INTO events ${sql.insert({ task_id: id, kind, detail })}`

      /** Fails when there is no such task. Inside a transaction, which holds the write lock. */
      const lockTask = (id: string) =>
        Effect.gen(function* () {
          const found = yield* sql`SELECT id FROM tasks WHERE id = ${id}`
          if (found.length === 0) return yield* noTask(id)
        })

      const get = (id: string) =>
        sql`SELECT * FROM tasks WHERE id = ${id}`.pipe(
          Effect.flatMap(rows(Task)),
          Effect.flatMap(([task]) => (task ? Effect.succeed(task) : Effect.fail(noTask(id)))),
          asOrqError("get"),
        )

      const insertTask = ({ repo, title, slug, base, type, source }: NewTask) =>
        Effect.gen(function* () {
          const [next] = yield* sql<{ n: number }>`SELECT coalesce(max(CAST(substr(id, 3) AS INTEGER)), 0) + 1 AS n FROM tasks`
          const id = taskId(next?.n ?? 1)
          const branch = `orq/${id}-${slug}`
          const row = { id, repo, title, branch, worktree: null, type: type ?? null, source: source ?? "cli" }
          yield* sql`INSERT INTO tasks ${sql.insert(row)}`
          yield* addEvent(id, "created", `${branch} from ${base}`)
          return yield* get(id)
        })
      const create = (task: NewTask) => insertTask(task).pipe(sql.withTransaction, asOrqError("create"))

      const start = (id: string, repo: string, worktree: string) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          const changed = yield* sql`UPDATE tasks SET repo = ${repo}, worktree = ${worktree}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ')
            WHERE id = ${id} AND worktree IS NULL RETURNING id`
          if (changed.length === 0) return yield* new OrqError({ message: `${id} is already started; orq resume ${id}` })
          yield* addEvent(id, "started", worktree)
        }).pipe(sql.withTransaction, asOrqError("start"))

      const unstart = (id: string, worktree: string) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          const changed = yield* sql`UPDATE tasks SET worktree = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ')
            WHERE id = ${id} AND worktree = ${worktree} RETURNING id`
          if (changed.length > 0) yield* addEvent(id, "start undone", worktree)
        }).pipe(sql.withTransaction, asOrqError("unstart"))

      const addFromIssue = ({ repo, url, title, request }: { repo: string; url: string; title: string; request: string }) =>
        Effect.gen(function* () {
          const [found] = yield* sql<{ task_id: string }>`SELECT task_id FROM task_links WHERE kind = 'gh-issue' AND ref = ${url} LIMIT 1`
          if (found) return { id: found.task_id, added: false }
          const { id } = yield* insertTask({ repo, title, slug: slugify(title), base: "the default branch", source: "github" })
          yield* sql`INSERT INTO task_links ${sql.insert({ task_id: id, kind: "gh-issue", ref: url, role: "origin" })}`
          yield* addEvent(id, "linked", `gh-issue ${url} (origin)`)
          const content = new TextEncoder().encode(`---\nid: ${id}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)
          const sha256 = createHash("sha256").update(content).digest("hex")
          yield* sql`INSERT INTO task_files ${sql.insert({ task_id: id, path: "REQUEST.md", sha256, content })}`
          return { id, added: true }
        }).pipe(sql.withTransaction, asOrqError("add from issue"))

      const setState = (id: string, step: Step, status: Status, note: string, message?: string) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          yield* sql`UPDATE tasks SET ${sql.update({ step, status })}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ') WHERE id = ${id}`
          yield* addEvent(id, `${step}: ${status}`, note)
          if (message !== undefined) yield* addEvent(id, "message", message)
        }).pipe(sql.withTransaction, asOrqError("set state"))

      const setType = (id: string, type: string) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          yield* sql`UPDATE tasks SET type = ${type}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ') WHERE id = ${id}`
          yield* addEvent(id, "type", type)
        }).pipe(sql.withTransaction, asOrqError("set type"))

      const link = (id: string, kind: string, ref: string, role: LinkRole) =>
        Effect.gen(function* () {
          yield* lockTask(id)
          yield* sql`INSERT INTO task_links ${sql.insert({ task_id: id, kind, ref, role })}
                     ON CONFLICT (task_id, kind, ref) DO UPDATE SET role = excluded.role`
          yield* addEvent(id, "linked", `${kind} ${ref} (${role})`)
        }).pipe(sql.withTransaction, asOrqError("link"))

      const putFiles = (
        id: string,
        put: ReadonlyArray<{ readonly path: string; readonly content: Uint8Array }>,
        keep: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const bad = [...put.map((f) => f.path), ...keep].find((p) => !isTaskFilePath(p))
          if (bad !== undefined) return yield* new OrqError({ message: `not a task file or evidence image: ${bad}` })
          const big = put.find((f) => f.content.byteLength > MAX_FILE_BYTES)
          if (big) return yield* new OrqError({ message: `${big.path} is over ${MAX_FILE_BYTES / 1024 / 1024} MB` })
          const all = new Set([...keep, ...put.map((f) => f.path)])
          if ([...all].filter((p) => p.startsWith("evidence/")).length > MAX_IMAGES)
            return yield* new OrqError({ message: `more than ${MAX_IMAGES} evidence images` })
          yield* lockTask(id)
          for (const { path } of yield* sql<{ path: string }>`SELECT path FROM task_files WHERE task_id = ${id}`)
            if (!all.has(path)) yield* sql`DELETE FROM task_files WHERE task_id = ${id} AND path = ${path}`
          for (const { path, content } of put) {
            const sha256 = createHash("sha256").update(content).digest("hex")
            yield* sql`INSERT INTO task_files ${sql.insert({ task_id: id, path, sha256, content })}
                       ON CONFLICT (task_id, path) DO UPDATE SET sha256 = excluded.sha256, content = excluded.content,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ')`
          }
        }).pipe(sql.withTransaction, asOrqError("put files"))

      return {
        create,
        start,
        unstart,
        addFromIssue,
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
        findLink: (kind, ref) =>
          sql<{ task_id: string }>`SELECT task_id FROM task_links WHERE kind = ${kind} AND ref = ${ref} ORDER BY seq DESC LIMIT 1`.pipe(
            Effect.map(([row]) => row?.task_id ?? null),
            asOrqError("find link"),
          ),
        setType,
        fileSums: (id) =>
          sql`SELECT path, sha256 FROM task_files WHERE task_id = ${id} ORDER BY path`.pipe(
            Effect.flatMap(rows(FileSum)),
            asOrqError("file sums"),
          ),
        putFiles,
        now: (id) =>
          Effect.gen(function* () {
            const last = (kind: string) =>
              sql<{ seq: number; detail: string | null }>`SELECT seq, detail FROM events
                WHERE task_id = ${id} AND kind LIKE ${kind} ORDER BY seq DESC LIMIT 1`
            const [state] = yield* last("%: %")
            const [message] = yield* last("message")
            // orq ask writes its state event, then its message: a later state change makes it old
            return {
              note: state?.detail ?? "",
              message: message && (!state || message.seq > state.seq) ? message.detail : null,
            }
          }).pipe(asOrqError("now")),
        file: (id, path) =>
          sql<{ content: Uint8Array }>`SELECT content FROM task_files WHERE task_id = ${id} AND path = ${path}`.pipe(
            asOrqError("file"),
            Effect.flatMap(([row]) => (row ? Effect.succeed(row.content) : Effect.fail(new OrqError({ message: `no ${path} in ${id}` })))),
          ),
      }
    }),
  )
}
