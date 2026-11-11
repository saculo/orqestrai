// orq init through the command line: the project's own .orqestrai/config.toml, nothing in .claude/.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

let dir: string, repo: string

const orq = (args: string[], cwd = repo, extra: Record<string, string> = {}) => {
  const env = { ...process.env, ORQ_HOME: join(dir, "home"), ...extra }
  const p = Bun.spawnSync([...ORQ, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
const read = (p: string) => readFileSync(join(repo, p), "utf8")

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-init-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("orq init", () => {
  test("creates .orqestrai/config.toml with the base branch, and keeps an existing one", () => {
    expect(orq(["init"]).out).toContain("config.toml: written")
    expect(read(".orqestrai/config.toml")).toContain('base_branch = "main"')
    expect(read(".orqestrai/config.toml")).toContain("[commands]") // the quality gate's commands, to fill in
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = "develop"\n')
    expect(orq(["init"]).out).toContain("config.toml: kept")
    expect(read(".orqestrai/config.toml")).toBe('base_branch = "develop"\n')
  })

  test("writes nothing into .claude/: the plugin brings the skills, agents and hook", () => {
    expect(orq(["init"]).out).toContain("claude plugin install orq@orqestrai")
    expect(existsSync(join(repo, ".claude"))).toBe(false)
  })

  test("warns when orq is not on PATH, because the plugin starts it by name", () => {
    const r = orq(["init"], repo, { PATH: "/usr/bin:/bin" })
    expect(r.code).toBe(0)
    expect(r.err).toContain("orq is not on PATH")
  })

  test("fails outside a git repository", () => {
    const r = orq(["init"], dir)
    expect(r.code).toBe(1)
    expect(r.err).toContain("orq: not in a git repository")
  })
})
