// After ship, through the command line: the merged state read from GitHub, and orq clean.
// A fake `gh` on PATH stands for GitHub: FAKE_GH_STATE and FAKE_GH_HEAD set its answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

let dir: string, repo: string, home: string, fakeBin: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
  return p.stdout.toString().trim()
}
const git = (args: string[], cwd: string) => sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd)

const orq = (args: string[], gh: Record<string, string> = {}) => {
  const env = {
    ...process.env,
    ORQ_DATA: home,
    ORQ_HC: "orq-test-no-hc",
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    PATH: `${fakeBin}:${process.env.PATH}`,
    ...gh,
  }
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const worktree = () => join(home, "worktrees", "proj", "T-0001-add-search")
const branchExists = () =>
  Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", "refs/heads/orq/T-0001-add-search"], { cwd: repo }).exitCode === 0
const head = () => sh(["git", "rev-parse", "HEAD"], worktree())

/** A task with a committed task file and an open PR for its branch, as ship leaves it. */
const shipped = () => {
  orq(["new", "Add search"])
  writeFileSync(join(worktree(), ".orqestrai/tasks/T-0001/BRIEF.md"), "brief\n")
  git(["add", "."], worktree())
  git(["commit", "-q", "-m", "docs(T-0001): brief"], worktree())
  orq(["set-state", "T-0001", "ship", "WAITING FOR ME", "--note", "PR open"])
}
const merged = () => ({ FAKE_GH_STATE: "MERGED", FAKE_GH_HEAD: head() })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-clean-"))
  repo = join(dir, "proj")
  home = join(dir, "home")
  fakeBin = join(dir, "bin")
  mkdirSync(repo)
  mkdirSync(fakeBin)
  writeFileSync(
    join(fakeBin, "gh"),
    // the PR of the task's branch, then (once orq recorded it) the same PR by its URL
    // FAKE_GH_REPLACED: PR 7 was closed, and the branch has PR 8 now
    `#!/bin/sh
[ -n "$FAKE_GH_FAIL" ] && exit 1
case "$*" in
  "pr view https://github.com/o/r/pull/7 --json url,state,headRefOid")
    if [ -n "$FAKE_GH_REPLACED" ]; then printf '{"url":"https://github.com/o/r/pull/7","state":"CLOSED","headRefOid":"old"}'; exit; fi
    url=https://github.com/o/r/pull/7 ;;
  "pr view https://github.com/o/r/pull/8 --json url,state,headRefOid") url=https://github.com/o/r/pull/8 ;;
  "pr view orq/T-0001-add-search --json url,state,headRefOid")
    url=https://github.com/o/r/pull/7; [ -n "$FAKE_GH_REPLACED" ] && url=https://github.com/o/r/pull/8 ;;
  *) echo "unexpected: gh $*" >&2; exit 2 ;;
esac
printf '{"url":"%s","state":"%s","headRefOid":"%s"}' "$url" "$FAKE_GH_STATE" "$FAKE_GH_HEAD"
`,
  )
  chmodSync(join(fakeBin, "gh"), 0o755)
  git(["init", "-q", "-b", "main"], repo)
  git(["commit", "-q", "--allow-empty", "-m", "init"], repo)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("the merged state, read from GitHub", () => {
  test("a merged PR makes the task MERGED, in orq ls and orq show", () => {
    shipped()
    expect(orq(["ls"], merged()).out).toContain("MERGED")
    expect(orq(["show", "T-0001"]).out).toMatch(/status = MERGED[\s\S]*PR https:\/\/github.com\/o\/r\/pull\/7 merged/)
  })

  test("an open PR leaves the task waiting", () => {
    shipped()
    expect(orq(["show", "T-0001"], { FAKE_GH_STATE: "OPEN", FAKE_GH_HEAD: "x" }).out).toContain("status = WAITING FOR ME")
  })

  test("a PR closed and replaced by a new one on the branch: the new one counts", () => {
    shipped()
    const shown = orq(["show", "T-0001"], { ...merged(), FAKE_GH_REPLACED: "1" }).out
    expect(shown).toMatch(/status = MERGED[\s\S]*PR https:\/\/github.com\/o\/r\/pull\/8 merged/)
    expect(shown).toContain("link gh-pr https://github.com/o/r/pull/8 (related)")
  })

  test("when gh fails, the task stays as it is and orq ls still works", () => {
    shipped()
    const r = orq(["ls"], { FAKE_GH_FAIL: "1" })
    expect(r.code).toBe(0)
    expect(r.out).toContain("WAITING FOR ME")
  })
})

describe("orq clean", () => {
  test("refuses a task that is not finished", () => {
    orq(["new", "Add search"])
    const r = orq(["clean", "T-0001"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("T-0001 is TODO")
    expect(existsSync(worktree())).toBe(true)
  })

  test("removes a merged task's worktree and branch, and keeps the task", () => {
    shipped()
    const r = orq(["clean", "T-0001"], merged())
    expect(r.code).toBe(0)
    expect(existsSync(worktree())).toBe(false)
    expect(branchExists()).toBe(false)
    expect(orq(["show", "T-0001"]).out).toMatch(/status = MERGED[\s\S]*link gh-pr[\s\S]*cleaned: removed worktree/)
  })

  test("removes the worktree's entry from Claude's config and keeps the rest", () => {
    mkdirSync(join(dir, "claude"))
    writeFileSync(join(dir, "claude", ".claude.json"), '{"numStartups":3,"projects":{"/a":{"hasTrustDialogAccepted":true}}}')
    orq(["new", "Add search"])
    const file = () => JSON.parse(readFileSync(join(dir, "claude", ".claude.json"), "utf8"))
    expect(Object.keys(file().projects)).toHaveLength(2)
    writeFileSync(join(worktree(), ".orqestrai/tasks/T-0001/BRIEF.md"), "no\n")
    git(["add", "."], worktree())
    git(["commit", "-q", "-m", "docs(T-0001): drop"], worktree())
    orq(["set-state", "T-0001", "triage", "DROPPED"])
    expect(orq(["clean", "T-0001"]).code).toBe(0)
    expect(file()).toEqual({ numStartups: 3, projects: { "/a": { hasTrustDialogAccepted: true } } })
  })

  test("refuses when the branch has commits that are not in the PR", () => {
    shipped()
    const gh = merged()
    git(["commit", "-q", "--allow-empty", "-m", "late fix"], worktree())
    const r = orq(["clean", "T-0001"], gh)
    expect(r.code).toBe(1)
    expect(r.err).toContain("some commits are not in the PR")
    expect(existsSync(worktree())).toBe(true)
  })

  test("refuses when the branch has commits that are not in the PR, also without its worktree", () => {
    shipped()
    const gh = merged()
    git(["commit", "-q", "--allow-empty", "-m", "late fix"], worktree())
    git(["worktree", "remove", worktree()], repo)
    const r = orq(["clean", "T-0001"], gh)
    expect(r.code).toBe(1)
    expect(r.err).toContain("some commits are not in the PR")
    expect(branchExists()).toBe(true)
  })

  test("refuses when the worktree has uncommitted changes", () => {
    shipped()
    writeFileSync(join(worktree(), "notes.txt"), "draft\n")
    const r = orq(["clean", "T-0001"], merged())
    expect(r.code).toBe(1)
    expect(r.err).toContain("uncommitted changes")
    expect(existsSync(worktree())).toBe(true)
  })

  test("archives a dropped task's files before it removes them", () => {
    orq(["new", "Add search"])
    writeFileSync(join(worktree(), ".orqestrai/tasks/T-0001/BRIEF.md"), "we will not do this\n")
    git(["add", "."], worktree())
    git(["commit", "-q", "-m", "docs(T-0001): drop"], worktree())
    orq(["set-state", "T-0001", "triage", "DROPPED"])
    const r = orq(["clean", "T-0001"])
    expect(r.code).toBe(0)
    expect(readFileSync(join(home, "archive/proj/T-0001/BRIEF.md"), "utf8")).toBe("we will not do this\n")
    expect(existsSync(worktree())).toBe(false)
    expect(branchExists()).toBe(false)
  })

  test("archives the out-of-scope note a dropped task wrote on its branch", () => {
    orq(["new", "Add search"])
    mkdirSync(join(worktree(), ".orqestrai/out-of-scope"), { recursive: true })
    writeFileSync(join(worktree(), ".orqestrai/out-of-scope/search.md"), "# Search\n")
    git(["add", "."], worktree())
    git(["commit", "-q", "-m", "docs(T-0001): search is out of scope"], worktree())
    orq(["set-state", "T-0001", "triage", "DROPPED"])
    expect(orq(["clean", "T-0001"]).code).toBe(0)
    expect(readFileSync(join(home, "archive/proj/T-0001/out-of-scope/search.md"), "utf8")).toBe("# Search\n")
    expect(branchExists()).toBe(false)
  })

  test("refuses a dropped branch that changes other files, so they are not lost", () => {
    orq(["new", "Add search"])
    writeFileSync(join(worktree(), "search.ts"), "export {}\n")
    git(["add", "."], worktree())
    git(["commit", "-q", "-m", "wip"], worktree())
    orq(["set-state", "T-0001", "triage", "DROPPED"])
    const r = orq(["clean", "T-0001"])
    expect(r.code).toBe(1)
    expect(r.err).toContain("outside its task folder and .orqestrai/out-of-scope/: search.ts")
    expect(existsSync(worktree())).toBe(true)
    expect(branchExists()).toBe(true)
  })
})
