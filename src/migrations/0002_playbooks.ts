// Verify slots are gone; a task records its type: the name of the playbook it runs (the workflow skills choose it).
// A migration is frozen once merged: change the schema with a new numbered file, never here.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`DROP TABLE slots`
  yield* sql`ALTER TABLE tasks ADD COLUMN type text CHECK (type ~ '^[a-z][a-z0-9-]*$')`
})
