// Where each task was started (domain.ts, SOURCES). Tasks from before this were started in a
// terminal, or by the Slack bridge, which linked their thread as the origin.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli'
      CHECK (source IN ('cli', 'slack', 'github'))`
  yield* sql`
    UPDATE tasks SET source = 'slack'
    WHERE id IN (SELECT task_id FROM task_links WHERE kind = 'slack-thread' AND role = 'origin')`
})
