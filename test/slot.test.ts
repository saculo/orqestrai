// Verify slots through the command line: take, wait, keep, free, expiry.
// ORQ_SERVE / ORQ_UNSERVE and the stop commands write marker files, so the test sees them run.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { freshDatabase, startPostgres } from "./pg.ts"

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts")
let dir: string, repo: string, home: string, pg: Record<string, string>

const orq = (args: string[], extra: Record<string, string> = {}) => {
  const env = { ...process.env, ORQ_HOME: home, ...pg, ORQ_ZELLIJ_SESSION: "orq-test-none", ...extra } as Record<string, string | undefined>
  delete env.ZELLIJ
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
const marker = (name: string) => join(dir, name)

beforeAll(startPostgres, 120_000)

beforeEach(async () => {
  pg = await freshDatabase()
  dir = mkdtempSync(join(tmpdir(), "orq-slot-"))
  repo = join(dir, "proj")
  home = join(dir, "home")
  mkdirSync(repo)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
  orq(["new", "one"])
  orq(["new", "two"])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("orq slot", () => {
  test("take gives the slot, its port range and a compose project name", () => {
    const r = orq(["slot", "take", "T-0001"])
    expect(r.code).toBe(0)
    expect(r.out).toBe("ORQ_SLOT=1\nORQ_PORT_BASE=4100\nORQ_PROJECT=orq-t-0001\n")
  })

  test("a second task gets the next slot, with its own ports", () => {
    orq(["slot", "take", "T-0001"], { ORQ_SLOTS: "2" })
    expect(orq(["slot", "take", "T-0002"], { ORQ_SLOTS: "2" }).out).toContain("ORQ_SLOT=2\nORQ_PORT_BASE=4200")
  })

  test("taking again keeps the same slot", () => {
    orq(["slot", "take", "T-0001"])
    expect(orq(["slot", "take", "T-0001"]).out).toContain("ORQ_SLOT=1")
  })

  test("each machine has its own slots in the shared database", () => {
    orq(["slot", "take", "T-0001"], { ORQ_HOST: "vps" })
    expect(orq(["slot", "take", "T-0002"], { ORQ_HOST: "laptop" }).out).toContain("ORQ_SLOT=1")
    expect(orq(["slot", "ls"], { ORQ_HOST: "laptop" }).out).not.toContain("T-0001")
  })

  test("when every slot is taken, take fails and names who holds it", () => {
    orq(["slot", "take", "T-0001"])
    const r = orq(["slot", "take", "T-0002"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("no free verify slot; held by T-0001")
  })

  test("take --wait gets the slot when it is freed while waiting", async () => {
    orq(["slot", "take", "T-0001"])
    const env = { ...process.env, ORQ_HOME: home, ...pg } as Record<string, string | undefined>
    delete env.ZELLIJ
    const waiting = Bun.spawn([process.execPath, CLI, "slot", "take", "T-0002", "--wait", "20"], { cwd: repo, env, stdout: "pipe" })
    await Bun.sleep(1500)
    orq(["slot", "free", "T-0001"])
    expect(await waiting.exited).toBe(0)
    expect(await new Response(waiting.stdout).text()).toContain("ORQ_SLOT=1")
  })

  test("free frees the slot for the next task", () => {
    orq(["slot", "take", "T-0001"])
    expect(orq(["slot", "free", "T-0001"]).out).toContain("freed slot 1")
    expect(orq(["slot", "take", "T-0002"]).code).toBe(0)
  })

  test("keep serves the port; free stops the app and stops serving", () => {
    const env = { ORQ_SERVE: `touch ${marker("served-{port}")}`, ORQ_UNSERVE: `touch ${marker("unserved-{port}")}` }
    orq(["slot", "take", "T-0001"], env)
    expect(orq(["slot", "keep", "T-0001", "--stop", `touch ${marker("stopped")}`, "--port", "4100"], env).code).toBe(0)
    expect(existsSync(marker("served-4100"))).toBe(true)
    expect(orq(["slot", "ls"]).out).toContain("T-0001  until")
    expect(orq(["slot", "free", "T-0001"], env).out).toContain("stopped the app")
    expect(existsSync(marker("stopped"))).toBe(true)
    expect(existsSync(marker("unserved-4100"))).toBe(true)
  })

  test("an expired slot is stopped and given to the next task", async () => {
    orq(["slot", "take", "T-0001"], { ORQ_SLOT_TTL: "1" })
    orq(["slot", "keep", "T-0001", "--stop", `echo gone > ${marker("stopped")}`, "--port", "4100"], { ORQ_SLOT_TTL: "1" })
    await Bun.sleep(1200)
    expect(orq(["slot", "take", "T-0002"]).out).toContain("ORQ_SLOT=1")
    expect(readFileSync(marker("stopped"), "utf8")).toBe("gone\n")
  })

  test("keep without a slot fails", () => {
    expect(orq(["slot", "keep", "T-0001", "--stop", "true", "--port", "1"]).err).toContain("holds no slot")
  })
})
