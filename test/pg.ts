// A real Postgres for the tests: one container for the whole run (testcontainers), and a new
// empty database for each test. Never the shared instance.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { SQL } from "bun"
import { Wait } from "testcontainers"

let started: Promise<{ container: StartedPostgreSqlContainer; admin: SQL }> | undefined

const start = async () => {
  // The default log wait never finishes under Bun; the image's health check does.
  const container = await new PostgreSqlContainer("postgres:18-alpine").withWaitStrategy(Wait.forHealthCheck()).start()
  const admin = new SQL({
    hostname: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    tls: false,
  })
  return { container, admin }
}

/** The PG* variables of a new, empty database, for an orq run. */
export const freshDatabase = async (): Promise<Record<string, string>> => {
  started ??= start()
  const { container, admin } = await started
  const name = `t_${crypto.randomUUID().replaceAll("-", "")}`
  await admin.unsafe(`CREATE DATABASE ${name}`)
  return {
    PGHOST: container.getHost(),
    PGPORT: String(container.getPort()),
    PGUSER: container.getUsername(),
    PGPASSWORD: container.getPassword(),
    PGDATABASE: name,
    PGSSLMODE: "disable",
  }
}

/** Starts the container once; give it to beforeAll, as the first start pulls the image. */
export const startPostgres = async (): Promise<void> => {
  started ??= start()
  await started
}
