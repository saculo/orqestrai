// The Postgres database that holds orq's state: tasks, events, links and verify slots.
// One shared instance serves every machine. Settings are libpq's PG* variables; on the VPS,
// `bws run` sets them from Bitwarden. PGSSLMODE as in libpq: require (default) encrypts,
// verify-ca also checks the server against PGSSLROOTCERT (the shared instance's self-signed
// certificate, pinned), disable is for local tests only.
// Only the commands that need state get this layer (src/cli.ts), so `orq init` never connects.
import { readFileSync } from "node:fs"
import type { ConnectionOptions } from "node:tls"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted } from "effect"
import * as Migrator from "effect/sql/Migrator"
import { OrqError } from "./domain.ts"
import init from "./migrations/0001_init.ts"

/** Every migration, in order. A schema change is a new file in src/migrations/ and a line here. */
const MIGRATIONS = { "0001_init": init }

/** The ssl option for a libpq PGSSLMODE. verify-ca trusts only the given certificate and, as in
 * libpq, does not match the host name (a self-signed certificate names its own host). */
export const sslFor = (mode: string, rootCert: string): boolean | ConnectionOptions => {
  if (mode === "disable") return false
  if (mode === "require") return { rejectUnauthorized: false }
  if (mode === "verify-ca") {
    if (!rootCert) throw new Error("PGSSLMODE=verify-ca needs PGSSLROOTCERT")
    return { ca: readFileSync(rootCert, "utf8"), checkServerIdentity: () => undefined }
  }
  throw new Error(`PGSSLMODE=${mode} is not supported; use disable, require or verify-ca`)
}

/** A timestamp as orq prints it: UTC, to the second. */
export const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ")

/** Database failures become messages the CLI prints; an OrqError passes through. */
export const asOrqError = (what: string) =>
  Effect.mapError((e: { readonly message: string } | OrqError) =>
    e instanceof OrqError ? e : new OrqError({ message: `database: ${what}: ${e.message}` }),
  )

const env = (name: string, fallback: string) => Config.String(name).pipe(Config.withDefault(fallback))

const client = Layer.unwrap(
  Effect.gen(function* () {
    const host = yield* env("PGHOST", "")
    if (!host) return yield* new OrqError({ message: "no database: PGHOST is not set (on the VPS, run orq under `bws run`)" })
    const mode = yield* env("PGSSLMODE", "require")
    const rootCert = yield* env("PGSSLROOTCERT", "")
    const ssl = yield* Effect.try({
      try: () => sslFor(mode, rootCert),
      catch: (e) => new OrqError({ message: `database: ${e instanceof Error ? e.message : String(e)}` }),
    })
    return PgClient.layer({
      host,
      port: yield* Config.Int("PGPORT").pipe(Config.withDefault(5432)),
      database: yield* env("PGDATABASE", "orqestrai"),
      username: yield* env("PGUSER", ""),
      password: yield* Config.Redacted("PGPASSWORD").pipe(Config.withDefault(Redacted.make(""))),
      ssl,
      connectTimeout: "10 seconds",
      maxConnections: 2,
    })
  }),
)

/** Brings the schema up to date; parallel runs wait on the migrator's table lock. */
const migrate = Layer.effectDiscard(Migrator.make({})({ loader: Migrator.fromRecord(MIGRATIONS), table: "orq_migrations" }))

/** The SqlClient for orq's state, connected and migrated. */
export const Database = migrate.pipe(Layer.provideMerge(client))
