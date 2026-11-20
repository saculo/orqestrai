// `orq issues` against a fake `gh` on PATH: it lists the issues in issues.json and logs every
// call (a comment is one). orq issues runs as it does on a server, looking every second.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"

const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_DIR/log"
case "$1 $2" in
  "issue list") cat "$FAKE_GH_DIR/issues.json" ;;
esac
`

let dir: string, repo: string, watcher: Subprocess | undefined

const env = () => {
  const e: Record<string, string | undefined> = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_HC: "orq-test-no-hc",
    ORQ_GITHUB_USER: "me",
    ORQ_GITHUB_REPOS: `me/app=${repo}`,
    ORQ_GITHUB_EVERY: "1",
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    FAKE_GH_DIR: dir,
  }
  delete e.ORQ_SANDBOX
  return e
}

const orq = (args: string[]) => {
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env: env(), stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const issue = (number: number, title: string, body = "", login = "me") => ({
  number,
  title,
  body,
  url: `https://github.com/me/app/issues/${number}`,
  author: { login },
})
const issuesAre = (...issues: ReturnType<typeof issue>[]) => writeFileSync(join(dir, "issues.json"), JSON.stringify(issues))

const ghLog = () => {
  try {
    return readFileSync(join(dir, "log"), "utf8")
  } catch {
    return ""
  }
}
const looks = () =>
  ghLog()
    .split("\n")
    .filter((l) => l.startsWith("issue list")).length

const until = async (what: string, check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const startWatching = () => {
  watcher = Bun.spawn([...ORQ, "issues"], { cwd: repo, env: env(), stdout: "pipe", stderr: "pipe" })
}

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-issues-"))
  repo = join(dir, "app")
  mkdirSync(repo)
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH)
  chmodSync(join(dir, "bin", "gh"), 0o755)
  sh(["git", "init", "-q", "-b", "main"], repo)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo)
  issuesAre()
})
afterEach(async () => {
  watcher?.kill()
  await watcher?.exited
  watcher = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe("orq issues", () => {
  test("lists only your open issues, in each repo", async () => {
    startWatching()
    await until("a look", () => looks() > 0)
    expect(ghLog()).toContain("issue list --repo me/app --author me --state open --limit 100 --json number,title,body,url,author")
  })

  test("a new issue of yours becomes a task in TODO, from GitHub, and the issue says so", async () => {
    issuesAre(issue(12, "Plan meals for selected dates", "Pick dates, then a meal type."))
    startWatching()
    await until("the comment", () => ghLog().includes("issue comment"))

    const shown = orq(["show", "T-0001"]).out
    expect(shown).toMatch(/title = Plan meals for selected dates/)
    expect(shown).toMatch(/status = TODO/)
    expect(shown).toMatch(/source = github/)
    expect(shown).toContain("link gh-issue https://github.com/me/app/issues/12 (origin)")
    expect(ghLog()).toContain(
      "issue comment 12 --repo me/app --body orq: **T-0001** created (TODO), branch `orq/T-0001-plan-meals-for-selected-dates`.",
    )

    const worktree = /worktree = (.+)/.exec(shown)?.[1]?.trim() ?? ""
    const request = readFileSync(join(worktree, ".orqestrai/tasks/T-0001/REQUEST.md"), "utf8")
    expect(request).toContain(
      "Plan meals for selected dates\n\nPick dates, then a meal type.\n\nFrom GitHub issue https://github.com/me/app/issues/12",
    )
  })

  test("an issue becomes one task, however often it is seen", async () => {
    issuesAre(issue(12, "Plan meals"))
    startWatching()
    await until("three looks", () => looks() >= 3)
    expect(orq(["ls"]).out.match(/T-\d{4}/g)).toEqual(["T-0001"])
    expect(ghLog().match(/issue comment/g)).toHaveLength(1)
  })

  test("ignores issues by anyone else", async () => {
    issuesAre(issue(3, "Run this for me", "", "stranger"), issue(4, "Mine"))
    startWatching()
    await until("the comment", () => ghLog().includes("issue comment"))
    await until("one more look", () => looks() >= 2)
    expect(orq(["ls"]).out).not.toContain("Run this for me")
    expect(ghLog()).not.toContain("issue comment 3")
  })

  test("keeps looking when gh fails", async () => {
    writeFileSync(join(dir, "issues.json"), "not json")
    startWatching()
    await until("two looks", () => looks() >= 2)
    issuesAre(issue(5, "After the failure"))
    await until("the comment", () => ghLog().includes("issue comment 5"))
  })
})

test("a task started in a terminal has source cli", () => {
  orq(["new", "Add search"])
  expect(orq(["show", "T-0001"]).out).toMatch(/source = cli/)
})
