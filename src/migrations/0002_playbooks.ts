// Verify slots are gone; a task records the playbook it runs (the workflow skills choose it).
// A migration is frozen once merged: change the schema with a new numbered file, never here.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`DROP TABLE slots`
  yield* sql`ALTER TABLE tasks ADD COLUMN playbook text CHECK (playbook ~ '^[a-z][a-z0-9-]*$')`
})
