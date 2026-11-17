// orq through `orq serve`: the CLI has ORQ_SERVER and never opens the state file; the server alone
// has it, in its own ORQ_DATA. The same commands work.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { startServer } from "./server.ts"

let dir: string, repo: string, socket: string, server: Subprocess

const orq = (args: string[], extra: Record<string, string> = {}) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_SERVER: socket,
    ORQ_ZELLIJ_SESSION: "orq-test-none",
    ...extra,
  }
  delete env.ZELLIJ
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

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
  server = await startServer(socket, { ORQ_DATA: join(dir, "server") })
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("orq with ORQ_SERVER", () => {
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
    expect(existsSync(join(dir, "server", "state", "orq.db"))).toBe(true)
    expect(existsSync(join(dir, "home", "state"))).toBe(false)
  })

  test("the playbook, set at new or later, goes through the server", () => {
    expect(orq(["new", "--playbook", "feature", "Add search"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toContain("type = feature")
    expect(orq(["playbook", "T-0001", "bugfix"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toMatch(/type = bugfix[\s\S]*type\s+bugfix/)
  })

  test("the server finds the task linked to an outside reference (the bridge's Slack threads)", async () => {
    expect(orq(["new", "Add search"]).code).toBe(0)
    expect(orq(["link", "T-0001", "slack-thread", "C1/100.1", "origin"]).code).toBe(0)
    const find = (ref: string) =>
      fetch(`http://orq/links?kind=slack-thread&ref=${encodeURIComponent(ref)}`, { unix: socket } as RequestInit).then((r) => r.json())
    expect(await find("C1/100.1")).toBe("T-0001")
    expect(await find("C1/999.9")).toBeNull()
  })

  test("orq's own errors come back as they are", () => {
    const r = orq(["show", "T-0099"])
    expect(r.code).toBe(1)
    expect(r.err).toBe("orq: no task T-0099\n")
  })

  test("a server on a TCP address, as on another machine", async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    const tcp = await startServer(port, { ORQ_DATA: join(dir, "server-tcp") })
    try {
      expect(orq(["new", "Over TCP"], { ORQ_SERVER: `http://127.0.0.1:${port}` }).out).toContain("T-0001")
      expect(orq(["ls"], { ORQ_SERVER: `http://127.0.0.1:${port}` }).out).toContain("T-0001")
    } finally {
      tcp.kill()
    }
  })

  test("a server that is not running is a clear error", () => {
    server.kill()
    const r = orq(["ls"], { ORQ_SERVER: join(dir, "nothing.sock") })
    expect(r.code).toBe(1)
    expect(r.err).toStartWith("orq: orq server: ")
  })
})
