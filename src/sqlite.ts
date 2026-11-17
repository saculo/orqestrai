// The SQLite file that holds orq's state: tasks, events and links, in $ORQ_DATA/state/orq.db.
// A folder of its own, as SQLite writes its -wal and -shm files next to it: a sandbox can allow
// writes to that folder and nothing else of $ORQ_DATA.
// Without a server each orq run opens it; with one, only `orq serve` does and its clients set
// ORQ_SERVER. Transactions take the write lock (BEGIN IMMEDIATE), so parallel runs wait their turn.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Context, Effect, Layer, Schema } from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Migrator from "effect/sql/Migrator"
import { SqlClient } from "effect/sql/SqlClient"
import { OrqConfig } from "./config.ts"
import { OrqError } from "./domain.ts"
import init from "./migrations/0001_init.ts"

/** Every migration, in order. A schema change is a new file in src/migrations/ and a line here. */
const MIGRATIONS = { "0001_init": init }

/** Any failure becomes a message the CLI prints; an OrqError passes through as it is. */
export const asOrqError =
  (what: string) =>
  <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, OrqError, R> =>
    Effect.mapError(self, (e) => (e instanceof OrqError ? e : new OrqError({ message: `database: ${what}: ${e.message}` })))

/** Checks query rows against a schema. */
export const rows = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

const client = Layer.effectContext(
  Effect.gen(function* () {
    const dir = join((yield* OrqConfig).home, "state")
    yield* Effect.try({
      try: () => mkdirSync(dir, { recursive: true }),
      catch: (e) => new OrqError({ message: `database: cannot create ${dir}: ${e instanceof Error ? e.message : String(e)}` }),
    })
    const db = yield* SqliteClient.make({ filename: join(dir, "orq.db"), busyTimeout: "10 seconds" }).pipe(asOrqError("open"))
    return Context.make(SqlClient, db)
  }),
).pipe(Layer.provide(Reactivity.layer))

/** Deleting a task deletes its events and links. SQLite checks foreign keys only when asked. */
const foreignKeys = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
  }).pipe(asOrqError("open")),
)

/** Brings the schema up to date. */
const migrate = Layer.effectDiscard(
  Migrator.make({})({ loader: Migrator.fromRecord(MIGRATIONS), table: "orq_migrations" }).pipe(asOrqError("migrate")),
)

/** The SqlClient for orq's state, open and migrated. */
export const Database = Layer.mergeAll(migrate, foreignKeys).pipe(Layer.provideMerge(client))
