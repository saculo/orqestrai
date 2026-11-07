// The Postgres database that holds orq's state: tasks, events, links and verify slots.
// One shared instance serves every machine. Settings are libpq's PG* variables; on the VPS,
// `bws run` sets them from Bitwarden. PGSSLMODE as in libpq: require (default) encrypts,
// verify-ca also checks the server against PGSSLROOTCERT (the shared instance's self-signed
// certificate, pinned), disable is for local tests only.
import { readFileSync } from "node:fs"
import type { ConnectionOptions } from "node:tls"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Option, Schema } from "effect"
import * as Migrator from "effect/sql/Migrator"
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

/** The ssl option for a libpq PGSSLMODE. verify-ca trusts only the given certificate and, as in
 * libpq, does not match the host name (a self-signed certificate names its own host). */
const sslFor = (mode: string, rootCert: string): Effect.Effect<boolean | ConnectionOptions, OrqError> => {
  switch (mode) {
    case "disable":
      return Effect.succeed(false)
    case "require":
      return Effect.succeed({ rejectUnauthorized: false })
    case "verify-ca":
      return rootCert
        ? Effect.sync(() => ({ ca: readFileSync(rootCert, "utf8"), checkServerIdentity: () => undefined }))
        : Effect.fail(new OrqError({ message: "database: PGSSLMODE=verify-ca needs PGSSLROOTCERT" }))
    default:
      return Effect.fail(new OrqError({ message: `database: PGSSLMODE=${mode} is not supported; use disable, require or verify-ca` }))
  }
}

const settings = Config.all({
  host: Config.String("PGHOST").pipe(Config.withDefault("")),
  port: Config.Int("PGPORT").pipe(Config.withDefault(5432)),
  database: Config.String("PGDATABASE").pipe(Config.withDefault("orqestrai")),
  username: Config.String("PGUSER").pipe(Config.withDefault("")),
  password: Config.Redacted("PGPASSWORD").pipe(Config.option),
  sslMode: Config.String("PGSSLMODE").pipe(Config.withDefault("require")),
  rootCert: Config.String("PGSSLROOTCERT").pipe(Config.withDefault("")),
})

const client = PgClient.layerFrom(
  Effect.gen(function* () {
    const { host, sslMode, rootCert, password, ...rest } = yield* settings
    if (!host) return yield* new OrqError({ message: "no database: PGHOST is not set (on the VPS, run orq under `bws run`)" })
    return yield* PgClient.make({
      ...rest,
      host,
      password: Option.getOrUndefined(password),
      ssl: yield* sslFor(sslMode, rootCert),
      connectTimeout: "10 seconds",
      maxConnections: 2,
    })
  }).pipe(asOrqError("connect")),
)

/** Brings the schema up to date; parallel runs wait on the migrator's table lock. */
const migrate = Layer.effectDiscard(
  Migrator.make({})({ loader: Migrator.fromRecord(MIGRATIONS), table: "orq_migrations" }).pipe(asOrqError("migrate")),
)

/** The SqlClient for orq's state, connected and migrated. */
export const Database = migrate.pipe(Layer.provideMerge(client))
