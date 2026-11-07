// The first schema: tasks, their events and links, and verify slots.
// A migration is frozen once merged: change the schema with a new numbered file, never here.
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE tasks (
      id         text PRIMARY KEY,
      repo       text NOT NULL,
      title      text NOT NULL,
      branch     text NOT NULL,
      worktree   text NOT NULL,
      step       text NOT NULL DEFAULT 'triage'
                 CHECK (step IN ('triage', 'plan', 'impl', 'verify', 'learn', 'ship')),
      status     text NOT NULL DEFAULT 'TODO'
                 CHECK (status IN ('TODO', 'IN PROGRESS', 'WAITING FOR ME', 'BLOCKED', 'DROPPED', 'MERGED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`

  yield* sql`
    CREATE TABLE events (
      seq     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      at      timestamptz NOT NULL DEFAULT now(),
      kind    text NOT NULL,
      detail  text
    )`
  yield* sql`CREATE INDEX events_by_task ON events (task_id, seq)`

  yield* sql`
    CREATE TABLE task_links (
      seq     bigint GENERATED ALWAYS AS IDENTITY,
      task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      kind    text NOT NULL,
      ref     text NOT NULL,
      role    text NOT NULL CHECK (role IN ('origin', 'related')),
      PRIMARY KEY (task_id, kind, ref)
    )`

  yield* sql`
    CREATE TABLE slots (
      host       text NOT NULL,
      n          int NOT NULL,
      task_id    text NOT NULL UNIQUE REFERENCES tasks (id) ON DELETE CASCADE,
      worktree   text NOT NULL,
      expires_at timestamptz NOT NULL,
      kept       boolean NOT NULL DEFAULT false,
      stop       text,
      port       int,
      PRIMARY KEY (host, n)
    )`
})
