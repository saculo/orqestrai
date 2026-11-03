// The SQLite index of tasks. Content lives in Markdown and git; this is only the index.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { OrqConfig } from "./config.ts"
import { type LinkRole, OrqError, type Status, type Step, type Task, type TaskEvent, type TaskLink, taskId } from "./domain.ts"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT 'triage',
  status TEXT NOT NULL DEFAULT 'TODO',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events(
  task_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  detail TEXT);
CREATE TABLE IF NOT EXISTS task_links(
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (task_id, kind, ref));`

/** Columns that older databases have and the task no longer owns. */
const DROPPED_COLUMNS = ["pr_url", "slack_thread"]

const migrate = (d: Database) => {
  const cols = (d.query("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name)
  for (const c of DROPPED_COLUMNS) if (cols.includes(c)) d.exec(`ALTER TABLE tasks DROP COLUMN ${c}`)
}

export interface NewTask {
  readonly id: string
  readonly repo: string
  readonly title: string
  readonly branch: string
  readonly worktree: string
  readonly note: string
}

const attempt = <A>(what: string, f: () => A) =>
  Effect.try({ try: f, catch: (e) => new OrqError({ message: `database: ${what}: ${String(e)}` }) })

export class Db extends Context.Service<
  Db,
  {
    readonly nextId: Effect.Effect<string, OrqError>
    readonly insert: (task: NewTask) => Effect.Effect<void, OrqError>
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
      const { home } = yield* OrqConfig
      const db = yield* Effect.acquireRelease(
        attempt("open", () => {
          mkdirSync(home, { recursive: true })
          const d = new Database(join(home, "state.db"), { create: true, strict: true })
          d.exec(SCHEMA)
          migrate(d)
          return d
        }),
        (d) => Effect.sync(() => d.close()),
      )

      const addEvent = db.query("INSERT INTO events(task_id, kind, detail) VALUES($id, $kind, $detail)")
      const get = (id: string) =>
        attempt("get", () => db.query("SELECT * FROM tasks WHERE id = $id").get({ id }) as Task | null).pipe(
          Effect.flatMap((t) => (t ? Effect.succeed(t) : Effect.fail(new OrqError({ message: `no task ${id}` })))),
        )

      return {
        nextId: attempt("next id", () => {
          const row = db.query("SELECT IFNULL(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 AS n FROM tasks").get() as { n: number }
          return taskId(row.n)
        }),
        insert: (t) =>
          attempt("insert", () =>
            db.transaction(() => {
              db.query("INSERT INTO tasks(id, repo, title, branch, worktree) VALUES($id, $repo, $title, $branch, $worktree)").run({
                id: t.id,
                repo: t.repo,
                title: t.title,
                branch: t.branch,
                worktree: t.worktree,
              })
              addEvent.run({ id: t.id, kind: "created", detail: t.note })
            })(),
          ),
        get,
        setState: (id, step, status, note) =>
          get(id).pipe(
            Effect.flatMap(() =>
              attempt("set state", () =>
                db.transaction(() => {
                  db.query("UPDATE tasks SET step = $step, status = $status, updated_at = datetime('now') WHERE id = $id").run({
                    id,
                    step,
                    status,
                  })
                  addEvent.run({ id, kind: `${step}: ${status}`, detail: note })
                })(),
              ),
            ),
          ),
        list: attempt("list", () => db.query("SELECT * FROM tasks ORDER BY id").all() as Task[]),
        events: (id, limit) =>
          attempt(
            "events",
            () =>
              db
                .query("SELECT at, kind, detail FROM events WHERE task_id = $id ORDER BY rowid DESC LIMIT $limit")
                .all({ id, limit }) as TaskEvent[],
          ),
        link: (id, kind, ref, role) =>
          get(id).pipe(
            Effect.flatMap(() =>
              attempt("link", () =>
                db.transaction(() => {
                  db.query("INSERT OR REPLACE INTO task_links(task_id, kind, ref, role) VALUES($id, $kind, $ref, $role)").run({
                    id,
                    kind,
                    ref,
                    role,
                  })
                  addEvent.run({ id, kind: "linked", detail: `${kind} ${ref} (${role})` })
                })(),
              ),
            ),
          ),
        links: (id) =>
          attempt(
            "links",
            () => db.query("SELECT kind, ref, role FROM task_links WHERE task_id = $id ORDER BY rowid").all({ id }) as TaskLink[],
          ),
      }
    }),
  )
}
