// orq through its seam: the command line. Each test gets a fresh repo and ORQ_HOME.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts")
let dir: string, repo: string, home: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
  return p.stdout.toString().trim()
}

const orq = (args: string[], cwd = repo) => {
  const env = { ...process.env, ORQ_HOME: home, ORQ_ZELLIJ_SESSION: "orq-test-none" } as Record<string, string | undefined>
  delete env.ZELLIJ
  const p = Bun.spawnSync(["bun", CLI, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const worktreeOf = (id: string) => /worktree = (.+)/.exec(orq(["show", id]).out)![1]!.trim()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-test-"))
  repo = join(dir, "proj")
  home = join(dir, "home")
  mkdirSync(repo)
  sh(["git", "init", "-q", "-b", "main"], repo)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("orq new", () => {
  test("creates the branch, the worktree, REQUEST.md and the task row", () => {
    const r = orq(["new", "Add retries to the webhook sender"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("T-0001  orq/T-0001-add-retries-to-the-webhook-sender")

    const wt = worktreeOf("T-0001")
    expect(sh(["git", "branch", "--show-current"], wt)).toBe("orq/T-0001-add-retries-to-the-webhook-sender")
    expect(readFileSync(join(wt, ".orqestrai/tasks/T-0001/REQUEST.md"), "utf8")).toContain("Add retries to the webhook sender")
    expect(orq(["show", "T-0001"]).out).toMatch(/step = triage[\s\S]*status = TODO/)
  })

  test("without zellij, prints a start command that sets the guard variables", () => {
    const r = orq(["new", "x"])
    expect(r.out).toContain("ORQ_TASK=T-0001")
    expect(r.out).toContain("ORQ_BASE=main")
    expect(r.out).toContain("'/orqestrai:task T-0001'")
  })

  test("gives the next id to each new task", () => {
    orq(["new", "one"])
    expect(orq(["new", "two"]).out).toContain("T-0002  orq/T-0002-two")
  })

  test("takes the base branch from .orqestrai/config.toml", () => {
    sh(["git", "branch", "develop"], repo)
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = "develop"\n')
    expect(orq(["new", "x"]).out).toContain("ORQ_BASE=develop")
  })

  test("fails outside a git repository", () => {
    const r = orq(["new", "x"], dir)
    expect(r.code).toBe(1)
    expect(r.err).toContain("orq: not in a git repository")
  })

  test("fails when the base branch does not exist", () => {
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = "nope"\n')
    const r = orq(["new", "x"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("base branch 'nope' not found")
  })
})

describe("orq state", () => {
  test("records the step, the status and an event", () => {
    orq(["new", "x"])
    expect(orq(["state", "T-0001", "plan", "WAITING FOR ME", "2 questions"]).code).toBe(0)
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toMatch(/step = plan[\s\S]*status = WAITING FOR ME/)
    expect(shown).toContain("plan: WAITING FOR ME")
    expect(shown).toContain("2 questions")
  })

  test("rejects an unknown step or status", () => {
    orq(["new", "x"])
    expect(orq(["state", "T-0001", "nope", "TODO"]).code).not.toBe(0)
    expect(orq(["state", "T-0001", "plan", "DONE"]).code).not.toBe(0)
  })

  test("rejects an unknown task", () => {
    const r = orq(["state", "T-0099", "plan", "TODO"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("orq: no task T-0099")
  })
})

describe("orq file", () => {
  test("creates a task file from its template, with the id filled in", () => {
    orq(["new", "x"])
    const wt = worktreeOf("T-0001")
    const r = orq(["file", "T-0001", "BRIEF"], wt)
    expect(r.code).toBe(0)
    const brief = readFileSync(join(wt, ".orqestrai/tasks/T-0001/BRIEF.md"), "utf8")
    expect(brief).toContain("id: T-0001")
    expect(brief).toContain("status: draft")
  })

  test("does not overwrite an existing file", () => {
    orq(["new", "x"])
    const wt = worktreeOf("T-0001")
    orq(["file", "T-0001", "SPEC"], wt)
    const r = orq(["file", "T-0001", "SPEC"], wt)
    expect(r.code).toBe(1)
    expect(r.err).toContain("exists; edit it instead")
  })

  test("refuses outside the task's worktree", () => {
    orq(["new", "x"])
    const r = orq(["file", "T-0001", "BRIEF"], repo)
    expect(r.code).toBe(1)
    expect(r.err).toContain("are you in its worktree?")
  })
})

describe("orq open", () => {
  test("prints the start command again", () => {
    orq(["new", "x"])
    expect(orq(["open", "T-0001"]).out).toContain("ORQ_TASK=T-0001")
  })

  test("fails when the worktree is gone", () => {
    orq(["new", "x"])
    rmSync(worktreeOf("T-0001"), { recursive: true, force: true })
    const r = orq(["open", "T-0001"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("is gone")
    expect(existsSync(worktreeOf("T-0001"))).toBe(false)
  })
})

test("orq ls lists every task", () => {
  orq(["new", "first"])
  orq(["new", "second"])
  const out = orq(["ls"]).out
  expect(out).toContain("T-0001  triage  TODO")
  expect(out).toContain("second")
})
