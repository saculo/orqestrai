// The schema: tasks, their events and links. A task's type is the name of the playbook it runs.
// A migration is frozen once merged: change the schema with a new numbered file, never here.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  // Times are ISO 8601 UTC text, so they sort and read back as dates.
  yield* sql`
    CREATE TABLE tasks (
      id         TEXT PRIMARY KEY,
      repo       TEXT NOT NULL,
      title      TEXT NOT NULL,
      branch     TEXT NOT NULL,
      worktree   TEXT NOT NULL,
      step       TEXT NOT NULL DEFAULT 'triage'
                 CHECK (step IN ('triage', 'plan', 'impl', 'verify', 'learn', 'ship')),
      status     TEXT NOT NULL DEFAULT 'TODO'
                 CHECK (status IN ('TODO', 'IN PROGRESS', 'WAITING FOR ME', 'BLOCKED', 'DROPPED', 'MERGED')),
      type       TEXT CHECK (type GLOB '[a-z]*' AND type NOT GLOB '*[^a-z0-9-]*'),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ'))
    ) STRICT`

  yield* sql`
    CREATE TABLE events (
      seq     INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
      kind    TEXT NOT NULL,
      detail  TEXT
    ) STRICT`
  yield* sql`CREATE INDEX events_by_task ON events (task_id, seq)`

  yield* sql`
    CREATE TABLE task_links (
      seq     INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      kind    TEXT NOT NULL,
      ref     TEXT NOT NULL,
      role    TEXT NOT NULL CHECK (role IN ('origin', 'related')),
      UNIQUE (task_id, kind, ref)
    ) STRICT`
})
