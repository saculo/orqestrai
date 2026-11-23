// A copy of each task's files (REQUEST.md, the step files, the evidence images), sent by the CLI
// from the task's worktree (src/files.ts), so the dashboard shows them wherever orq serve runs.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  // path: relative to the task's folder, e.g. SPEC.md or evidence/V1/V1-list.png
  yield* sql`
    CREATE TABLE task_files (
      task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      sha256     TEXT NOT NULL,
      content    BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
      PRIMARY KEY (task_id, path)
    ) STRICT`
})
