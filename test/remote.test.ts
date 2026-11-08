// orq through `orq serve`: the CLI has ORQ_SERVER and no PG* variable, as a sandboxed session on
// the VPS. The server alone has the database login. The same commands work, and the slot's
// stop and serve commands still run on the client's side.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Subprocess } from "bun"
import { freshDatabase, startPostgres } from "./pg.ts"
import { startServer, withoutPg } from "./server.ts"

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts")
let dir: string, repo: string, socket: string, server: Subprocess

const orq = (args: string[], extra: Record<string, string> = {}) => {
  const env: Record<string, string | undefined> = {
    ...withoutPg(),
    ORQ_HOME: join(dir, "home"),
    ORQ_SERVER: socket,
    ORQ_ZELLIJ_SESSION: "orq-test-none",
    ...extra,
  }
  delete env.ZELLIJ
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
const marker = (name: string) => join(dir, name)

beforeAll(startPostgres, 120_000)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-remote-"))
  repo = join(dir, "proj")
  socket = join(dir, "orq.sock")
  mkdirSync(repo)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
  server = await startServer(socket, { ...(await freshDatabase()), ORQ_SLOT_TTL: "1" })
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("orq with ORQ_SERVER and no database login", () => {
  test("new, state, link, show and ls go through the server", () => {
    const created = orq(["new", "Add search"])
    expect(created.code).toBe(0)
    expect(created.out).toContain("T-0001  orq/T-0001-add-search")
    expect(existsSync(join(dir, "home", "worktrees", "proj", "T-0001-add-search", ".orqestrai", "tasks", "T-0001", "REQUEST.md"))).toBe(
      true,
    )

    expect(orq(["state", "T-0001", "impl", "IN PROGRESS", "wave 1"]).code).toBe(0)
    expect(orq(["link", "T-0001", "gh-issue", "o/r#3", "origin"]).code).toBe(0)
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toContain("step = impl")
    expect(shown).toContain("link gh-issue o/r#3 (origin)")
    expect(shown).toContain("impl: IN PROGRESS")
    expect(orq(["ls"]).out).toContain("T-0001  impl    IN PROGRESS")
  })

  test("orq's own errors come back as they are", () => {
    const r = orq(["show", "T-0099"])
    expect(r.code).toBe(1)
    expect(r.err).toBe("orq: no task T-0099\n")
  })

  test("slots: the server keeps the lock, the client stops and serves the app", () => {
    orq(["new", "one"])
    const env = { ORQ_SERVE: `touch ${marker("served-{port}")}`, ORQ_UNSERVE: `touch ${marker("unserved-{port}")}` }
    expect(orq(["slot", "take", "T-0001"]).out).toBe("ORQ_SLOT=1\nORQ_PORT_BASE=4100\nORQ_PROJECT=orq-t-0001\n")
    orq(["slot", "keep", "T-0001", "--stop", `touch ${marker("stopped")}`, "--port", "4100"], env)
    expect(existsSync(marker("served-4100"))).toBe(true)
    expect(orq(["slot", "free", "T-0001"], env).out).toContain("stopped the app")
    expect(existsSync(marker("stopped"))).toBe(true)
    expect(existsSync(marker("unserved-4100"))).toBe(true)
  })

  test("an expired slot's app is stopped by the client that takes the slot next", async () => {
    orq(["new", "one"])
    orq(["new", "two"])
    orq(["slot", "take", "T-0001"])
    orq(["slot", "keep", "T-0001", "--stop", `touch ${marker("stopped")}`, "--port", "4100"])
    await Bun.sleep(1200)
    expect(orq(["slot", "take", "T-0002"]).out).toContain("ORQ_SLOT=1")
    expect(existsSync(marker("stopped"))).toBe(true)
  })

  test("a server that is not running is a clear error", () => {
    server.kill()
    const r = orq(["ls"], { ORQ_SERVER: join(dir, "nothing.sock") })
    expect(r.code).toBe(1)
    expect(r.err).toStartWith("orq: orq server: ")
  })
})
