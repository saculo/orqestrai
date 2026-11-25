// orq through its seam: the command line. Each test gets a fresh repo and ORQ_DATA.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

let dir: string, repo: string, home: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
  return p.stdout.toString().trim()
}

const orq = (args: string[], cwd = repo, extra: Record<string, string> = {}) => {
  const env = { ...process.env, ORQ_DATA: home, ORQ_HC: "orq-test-no-hc", ...extra } as Record<string, string | undefined>
  if (!("ORQ_SANDBOX" in extra)) delete env.ORQ_SANDBOX
  const p = Bun.spawnSync([...ORQ, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

/** `orq new`, then `orq start` on the task it added; the two outputs together. A `new` that fails is its result. */
const begin = (args: string[], ...rest: Parameters<typeof orq> extends [unknown, ...infer R] ? R : never) => {
  const added = orq(args, ...rest)
  const id = /^(T-\d+)/.exec(added.out)?.[1]
  if (added.code !== 0 || !id) return added
  const started = orq(["start", id], ...rest)
  return { code: started.code, out: added.out + started.out, err: added.err + started.err }
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

describe("orq --version", () => {
  test("prints the version of this release", () => {
    expect(orq(["--version"]).out.trim()).toBe("orq v0.10.0")
  })
})

describe("orq new", () => {
  test("B1: adds a backlog task: no branch, no worktree, and says how to start it", () => {
    const r = orq(["new", "fix x"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("T-0001  orq/T-0001-fix-x")
    expect(r.out).toContain("start it: orq start T-0001")

    const shown = orq(["show", "T-0001"]).out
    expect(shown).toMatch(/step = triage[\s\S]*status = TODO/)
    expect(shown).toContain("worktree = null")
    expect(sh(["git", "branch", "--list", "orq/*"], repo)).toBe("")
    expect(orq(["ls"]).out).toContain("T-0001  triage  TODO")
  })

  test("B2: orq start makes the branch and the worktree, and REQUEST.md holds the request", () => {
    orq(["new", "Add retries to the webhook sender"])
    const r = orq(["start", "T-0001"])
    expect(r.code).toBe(0)

    const wt = worktreeOf("T-0001")
    expect(sh(["git", "branch", "--show-current"], wt)).toBe("orq/T-0001-add-retries-to-the-webhook-sender")
    expect(readFileSync(join(wt, ".orqestrai/tasks/T-0001/REQUEST.md"), "utf8")).toContain("Add retries to the webhook sender")
  })

  test("B3: start branches from the latest base of origin", () => {
    const origin = join(dir, "origin.git")
    sh(["git", "init", "-q", "--bare", "-b", "main", origin], dir)
    sh(["git", "remote", "add", "origin", origin], repo)
    sh(["git", "push", "-q", "origin", "main"], repo)
    const other = join(dir, "other")
    sh(["git", "clone", "-q", origin, other], dir)
    sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "upstream work"], other)
    sh(["git", "push", "-q", "origin", "main"], other)
    const upstream = sh(["git", "rev-parse", "HEAD"], other)
    orq(["new", "x"])

    expect(orq(["start", "T-0001"]).code).toBe(0)
    expect(sh(["git", "merge-base", "--is-ancestor", upstream, "HEAD"], worktreeOf("T-0001"))).toBe("")
  })

  test("B4: without an origin, start branches from the local base", () => {
    sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "local work"], repo)
    const local = sh(["git", "rev-parse", "HEAD"], repo)
    orq(["new", "x"])
    expect(orq(["start", "T-0001"]).code).toBe(0)
    expect(sh(["git", "rev-parse", "HEAD"], worktreeOf("T-0001"))).toBe(local)
  })

  test("B5: starting a started task fails, names orq resume and changes nothing", () => {
    orq(["new", "x"])
    orq(["start", "T-0001"])
    const wt = worktreeOf("T-0001")
    const r = orq(["start", "T-0001"])
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("orq resume T-0001")
    expect(worktreeOf("T-0001")).toBe(wt)
    expect(orq(["show", "T-0001"]).out).toContain("status = TODO")
  })

  test("a git failure at start blocks the task with git's message; after the fix, start works", () => {
    orq(["new", "x"])
    sh(["git", "branch", "orq/T-0001-x"], repo) // the branch the task wants exists already
    const r = orq(["start", "T-0001"])
    expect(r.code).not.toBe(0)
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toMatch(/step = triage[\s\S]*status = BLOCKED/)
    expect(shown).toContain("orq/T-0001-x")
    expect(shown).toContain("worktree = null")

    sh(["git", "branch", "-D", "orq/T-0001-x"], repo)
    expect(orq(["start", "T-0001"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toMatch(/status = TODO/)
  })

  test("without herdr-core, prints a start command that sets the guard variables", () => {
    const r = begin(["new", "x"])
    expect(r.out).toContain("ORQ_TASK=T-0001")
    expect(r.out).toContain("ORQ_BASE=main")
    expect(r.out).toContain("'/orq:task T-0001'")
    expect(r.out).toMatch(/&& env ORQ_TASK=T-0001/)
  })

  test("with ORQ_SANDBOX, the session starts inside the sandbox", () => {
    const r = begin(["new", "x"], repo, { ORQ_SANDBOX: "fence --" })
    expect(r.out).toMatch(/&& fence -- env ORQ_TASK=T-0001 .* claude /)
  })

  test("with ORQ_ADD_DIRS, the session gets each directory with --add-dir", () => {
    const r = begin(["new", "x"], repo, { ORQ_ADD_DIRS: "/srv/home:/srv/shared" })
    // --add-dir=<dir>: with a bare --add-dir, claude reads the prompt as one more directory
    expect(r.out).toMatch(/ claude --model opus --add-dir=\/srv\/home --add-dir=\/srv\/shared '\/orq:task T-0001'/)
  })

  test("gives two tasks started at the same moment different ids", async () => {
    const env = { ...process.env, ORQ_DATA: home, ORQ_HC: "orq-test-no-hc" } as Record<string, string | undefined>
    const start = (request: string) => Bun.spawn([...ORQ, "new", request], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
    const runs = [start("one"), start("two"), start("three")]
    const codes = await Promise.all(runs.map((p) => p.exited))
    expect(codes).toEqual([0, 0, 0])
    const ids = orq(["ls"]).out.match(/T-\d{4}/g) ?? []
    expect(new Set(ids).size).toBe(3)
  })

  test("takes the base branch from .orqestrai/config.toml", () => {
    sh(["git", "branch", "develop"], repo)
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = "develop"\n')
    expect(begin(["new", "x"]).out).toContain("ORQ_BASE=develop")
  })

  test("an empty base_branch counts as not set", () => {
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = ""\n')
    expect(begin(["new", "x"]).out).toContain("ORQ_BASE=main")
  })

  test("a config.toml that is not valid TOML is an orq error that names the file", () => {
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), "base_branch = \n")
    const r = begin(["new", "x"])
    expect(r.code).toBe(1)
    expect(r.err).toStartWith("orq: ")
    expect(r.err).toContain(".orqestrai/config.toml")
  })

  test("fails when the base branch does not exist", () => {
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai/config.toml"), 'base_branch = "nope"\n')
    const r = begin(["new", "x"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("base branch 'nope' not found")
  })
})

describe("orq set-state", () => {
  test("records the step, the status and an event", () => {
    begin(["new", "x"])
    expect(orq(["set-state", "T-0001", "plan", "WAITING FOR ME", "--note", "2 questions"]).code).toBe(0)
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toMatch(/step = plan[\s\S]*status = WAITING FOR ME/)
    expect(shown).toContain("plan: WAITING FOR ME")
    expect(shown).toContain("2 questions")
  })

  test("records a task dropped in triage", () => {
    begin(["new", "x"])
    expect(orq(["set-state", "T-0001", "triage", "DROPPED", "--note", "already built"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toMatch(/status = DROPPED/)
  })

  test("rejects an unknown step or status", () => {
    begin(["new", "x"])
    expect(orq(["set-state", "T-0001", "nope", "TODO"]).code).not.toBe(0)
    expect(orq(["set-state", "T-0001", "plan", "DONE"]).code).not.toBe(0)
  })

  test("rejects an unknown task", () => {
    const r = orq(["set-state", "T-0099", "plan", "TODO"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("orq: no task T-0099")
  })
})

describe("the playbook", () => {
  test("a new task has no playbook until one is chosen", () => {
    begin(["new", "x"])
    expect(orq(["show", "T-0001"]).out).toContain("type = null")
    expect(orq(["set-state", "T-0001", "triage", "IN PROGRESS", "--playbook", "feature"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toMatch(/type = feature[\s\S]*type\s+feature/)
  })

  test("orq new --playbook sets it at once", () => {
    expect(begin(["new", "--playbook", "bugfix", "Fix login"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toContain("type = bugfix")
  })

  test("rejects a name that is not a playbook's, and an unknown task", () => {
    begin(["new", "x"])
    expect(orq(["set-state", "T-0001", "triage", "IN PROGRESS", "--playbook", "Not A Name"]).code).not.toBe(0)
    expect(begin(["new", "--playbook", "-x", "y"]).code).not.toBe(0)
    expect(orq(["set-state", "T-0099", "triage", "IN PROGRESS", "--playbook", "feature"]).err).toContain("no task T-0099")
  })
})

describe("orq create-artifact", () => {
  test("creates a task file from its template, with the id filled in", () => {
    begin(["new", "x"])
    const wt = worktreeOf("T-0001")
    const r = orq(["create-artifact", "T-0001", "BRIEF"], wt)
    expect(r.code).toBe(0)
    const brief = readFileSync(join(wt, ".orqestrai/tasks/T-0001/BRIEF.md"), "utf8")
    expect(brief).toContain("id: T-0001")
    expect(brief).toContain("status: draft")
  })

  test("does not overwrite an existing file", () => {
    begin(["new", "x"])
    const wt = worktreeOf("T-0001")
    orq(["create-artifact", "T-0001", "SPEC"], wt)
    const r = orq(["create-artifact", "T-0001", "SPEC"], wt)
    expect(r.code).toBe(1)
    expect(r.err).toContain("exists; edit it instead")
  })

  test("refuses outside the task's worktree", () => {
    begin(["new", "x"])
    const r = orq(["create-artifact", "T-0001", "BRIEF"], repo)
    expect(r.code).toBe(1)
    expect(r.err).toContain("are you in its worktree?")
  })
})

describe("orq new --origin", () => {
  test("links the task to what it comes from, shown with the task", () => {
    expect(begin(["new", "--origin", "gh-issue:https://github.com/saculo/app/issues/12", "x"]).code).toBe(0)
    expect(orq(["show", "T-0001"]).out).toContain("link gh-issue https://github.com/saculo/app/issues/12 (origin)")
  })

  test("rejects an origin without a kind or a reference, and makes no task", () => {
    expect(begin(["new", "--origin", "APP-1", "x"]).err).toContain("expected KIND:REF")
    expect(begin(["new", "--origin", "jira:", "x"]).code).not.toBe(0)
    expect(orq(["ls"]).out).not.toContain("T-0001")
  })
})

describe("orq resume", () => {
  test("prints the start command again", () => {
    begin(["new", "x"])
    expect(orq(["resume", "T-0001"]).out).toContain("ORQ_TASK=T-0001")
  })

  test("fails when the worktree is gone", () => {
    begin(["new", "x"])
    rmSync(worktreeOf("T-0001"), { recursive: true, force: true })
    const r = orq(["resume", "T-0001"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("is gone")
    expect(existsSync(worktreeOf("T-0001"))).toBe(false)
  })
})

test("orq ls lists every task", () => {
  begin(["new", "first"])
  begin(["new", "second"])
  const out = orq(["ls"]).out
  expect(out).toContain("T-0001  triage  TODO")
  expect(out).toContain("second")
})

test("the state is one SQLite file in ORQ_DATA, made on first use; orq init never makes it", () => {
  expect(orq(["init"]).code).toBe(0)
  expect(existsSync(join(home, "state.db"))).toBe(false)
  begin(["new", "first"])
  expect(existsSync(join(home, "state.db"))).toBe(true)
})

test("parallel runs never share an id", async () => {
  const env = { ...process.env, ORQ_DATA: home, ORQ_HC: "orq-test-no-hc" } as Record<string, string | undefined>
  const runs = Array.from(
    { length: 6 },
    (_, i) => Bun.spawn([...ORQ, "new", `task ${i}`], { cwd: repo, env, stdout: "pipe", stderr: "pipe" }).exited,
  )
  expect(await Promise.all(runs)).toEqual([0, 0, 0, 0, 0, 0])
  const ids = [...orq(["ls"]).out.matchAll(/T-\d{4}/g)].map((m) => m[0])
  expect(new Set(ids).size).toBe(6)
})
