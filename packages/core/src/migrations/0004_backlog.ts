// Tasks that are not started: `worktree` may be NULL until `orq start` records it (Db.start).
// SQLite cannot drop NOT NULL, so the table is rebuilt (SQLite's own 12-step way). The foreign keys
// of events, task_links and task_files name `tasks`, so they stay as they are; sqlite.ts turns
// foreign key checks on only after the migrations, so the drop deletes nothing in them.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE tasks_new (
      id         TEXT PRIMARY KEY,
      repo       TEXT NOT NULL,
      title      TEXT NOT NULL,
      branch     TEXT NOT NULL,
      worktree   TEXT,
      step       TEXT NOT NULL DEFAULT 'triage'
                 CHECK (step IN ('triage', 'plan', 'impl', 'verify', 'learn', 'ship')),
      status     TEXT NOT NULL DEFAULT 'TODO'
                 CHECK (status IN ('TODO', 'IN PROGRESS', 'WAITING FOR ME', 'BLOCKED', 'DROPPED', 'MERGED')),
      type       TEXT CHECK (type GLOB '[a-z]*' AND type NOT GLOB '*[^a-z0-9-]*'),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
      source     TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('cli', 'slack', 'github'))
    ) STRICT`
  yield* sql`
    INSERT INTO tasks_new (id, repo, title, branch, worktree, step, status, type, created_at, updated_at, source)
    SELECT id, repo, title, branch, worktree, step, status, type, created_at, updated_at, source FROM tasks`
  yield* sql`DROP TABLE tasks`
  yield* sql`ALTER TABLE tasks_new RENAME TO tasks`
})
