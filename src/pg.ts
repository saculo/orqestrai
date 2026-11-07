// The Postgres database that holds orq's state: tasks, events, links and verify slots.
// One shared instance serves every machine. Settings are libpq's PG* variables; on the VPS,
// `bws run` sets them from Bitwarden. PGSSLMODE as in libpq: require (default) encrypts,
// verify-ca also checks the server against PGSSLROOTCERT (the shared instance's self-signed
// certificate, pinned), disable is for local tests only.
// Nothing connects until a command needs state, so `orq guard` and `orq init` never do.
import { readFileSync } from "node:fs"
import { SQL } from "bun"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { OrqError, STATUSES, STEPS } from "./domain.ts"

const oneOf = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ")

const SCHEMA = `
CREATE TABLE tasks(
  id text PRIMARY KEY,
  repo text NOT NULL,
  title text NOT NULL,
  branch text NOT NULL,
  worktree text NOT NULL,
  step text NOT NULL DEFAULT 'triage' CHECK (step IN (${oneOf(STEPS)})),
  status text NOT NULL DEFAULT 'TODO' CHECK (status IN (${oneOf(STATUSES)})),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE events(
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  detail text);
CREATE INDEX events_by_task ON events(task_id, seq);
CREATE TABLE task_links(
  seq bigint GENERATED ALWAYS AS IDENTITY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (task_id, kind, ref));
CREATE TABLE slots(
  host text NOT NULL,
  n int NOT NULL,
  task_id text NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  worktree text NOT NULL,
  expires_at timestamptz NOT NULL,
  kept boolean NOT NULL DEFAULT false,
  stop text,
  port int,
  PRIMARY KEY (host, n));`

/** Serializes schema creation when several orq runs start on an empty database. */
const SCHEMA_LOCK = 0x6f7271 // "orq"

/** Bun's tls option for a libpq PGSSLMODE. verify-ca trusts only the given certificate and,
 * as in libpq, does not match the host name (a self-signed certificate names its own host). */
export const tlsFor = (mode: string, rootCert: string): boolean | { ca: string; checkServerIdentity: () => undefined } => {
  if (mode === "disable") return false
  if (mode === "require") return true
  if (mode === "verify-ca") {
    if (!rootCert) throw new Error("PGSSLMODE=verify-ca needs PGSSLROOTCERT")
    return { ca: readFileSync(rootCert, "utf8"), checkServerIdentity: () => undefined }
  }
  throw new Error(`PGSSLMODE=${mode} is not supported; use disable, require or verify-ca`)
}

/** A timestamp as orq prints it: UTC, to the second. */
export const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ")

export class Pg extends Context.Service<
  Pg,
  {
    /** Runs a query (or a `sql.begin` transaction) once the schema exists. */
    readonly run: <A>(what: string, f: (sql: SQL) => Promise<A>) => Effect.Effect<A, OrqError>
  }
>()("orq/Pg") {
  static readonly layer = Layer.effect(
    Pg,
    Effect.gen(function* () {
      const env = (name: string, fallback: string) => Config.String(name).pipe(Config.withDefault(fallback))
      const hostname = yield* env("PGHOST", "")
      const port = yield* Config.Int("PGPORT").pipe(Config.withDefault(5432))
      const database = yield* env("PGDATABASE", "orqestrai")
      const username = yield* env("PGUSER", "")
      const password = yield* Config.Redacted("PGPASSWORD").pipe(Config.withDefault(Redacted.make("")))
      const sslMode = yield* env("PGSSLMODE", "require")
      const rootCert = yield* env("PGSSLROOTCERT", "")

      let client: SQL | undefined
      yield* Effect.addFinalizer(() => (client ? Effect.promise(() => (client as SQL).close()) : Effect.void))

      const attempt = <A>(what: string, f: () => Promise<A>) =>
        Effect.tryPromise({
          try: f,
          catch: (e) => new OrqError({ message: `database: ${what}: ${e instanceof Error ? e.message : String(e)}` }),
        })

      /** Connects on first use and creates the schema if the database is empty. */
      const ready = yield* Effect.cached(
        hostname
          ? attempt("connect", async () => {
              const sql = new SQL({
                hostname,
                port,
                database,
                username,
                password: Redacted.value(password),
                tls: tlsFor(sslMode, rootCert),
                max: 2,
                connectionTimeout: 10,
              })
              client = sql
              await sql.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(${SCHEMA_LOCK})`
                const [found] = await tx`SELECT to_regclass('slots') IS NOT NULL AS ok`
                if (!found.ok) await tx.unsafe(SCHEMA)
              })
              return sql
            })
          : Effect.fail(new OrqError({ message: "no database: PGHOST is not set (on the VPS, run orq under `bws run`)" })),
      )

      return {
        run: <A>(what: string, f: (sql: SQL) => Promise<A>) => ready.pipe(Effect.flatMap((sql) => attempt(what, () => f(sql)))),
      }
    }),
  )
}
