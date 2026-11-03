// orq through its seam: the command line. Each test gets a fresh repo and ORQ_HOME.
import { Database } from "bun:sqlite"
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

const worktreeOf = (id: string) => {
  const m = /worktree = (.+)/.exec(orq(["show", id]).out)
  if (!m?.[1]) throw new Error(`no worktree for ${id}`)
  return m[1].trim()
}

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
    expect(r.out).toContain("'/orq-task T-0001'")
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

  test("records a task dropped in triage", () => {
    orq(["new", "x"])
    expect(orq(["state", "T-0001", "triage", "DROPPED", "already built"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toMatch(/status = DROPPED/)
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

describe("orq link", () => {
  test("links a task to an outside reference, shown with the task", () => {
    orq(["new", "x"])
    expect(orq(["link", "T-0001", "gh-issue", "saculo/app#12", "origin"]).code).toBe(0)
    expect(orq(["link", "T-0001", "slack-thread", "C01/1730.42"]).code).toBe(0)
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toContain("link gh-issue saculo/app#12 (origin)")
    expect(shown).toContain("link slack-thread C01/1730.42 (related)")
  })

  test("keeps outside references out of the task itself", () => {
    orq(["new", "x"])
    const shown = orq(["show", "T-0001"]).out
    expect(shown).not.toContain("slack_thread")
    expect(shown).not.toContain("pr_url")
  })

  test("rejects an unknown role and an unknown task", () => {
    orq(["new", "x"])
    expect(orq(["link", "T-0001", "jira", "APP-1", "owner"]).code).not.toBe(0)
    const r = orq(["link", "T-0099", "jira", "APP-1"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("orq: no task T-0099")
  })

  test("moves an existing database to the new task shape", () => {
    mkdirSync(home, { recursive: true })
    const old = new Database(join(home, "state.db"))
    old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY, repo TEXT NOT NULL, title TEXT NOT NULL,
      branch TEXT NOT NULL, worktree TEXT NOT NULL, step TEXT NOT NULL DEFAULT 'triage',
      status TEXT NOT NULL DEFAULT 'TODO', pr_url TEXT, slack_thread TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO tasks(id, repo, title, branch, worktree, slack_thread) VALUES('T-0001', '/r', 'old', 'b', '/w', 'C01/1');`)
    old.close()
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toContain("title = old")
    expect(shown).not.toContain("slack_thread")
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
