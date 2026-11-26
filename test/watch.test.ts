// `orq watch`: the stream of tasks to start, against a test orq-server and a fake `hc`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { startServer } from "./server.ts"

const FAKE_HC = `#!/usr/bin/env bash
printf '%s|%s\\n' "\${HC_TERMINAL_ID:-}" "$*" >> "$FAKE_HC_DIR/log"
case "$1" in
  ls) cat "$FAKE_HC_DIR/terminals.json" ;;
  get) cat "$FAKE_HC_DIR/get-$2.json" ;;
esac
`
const TOKEN = "s3cret-token"
let dir: string, checkout: string, socket: string, trig: number
let server: Subprocess | undefined
const watchers: Subprocess[] = []

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}
const aRepo = (at: string) => {
  mkdirSync(at)
  sh(["git", "init", "-q", "-b", "main"], at)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], at)
}

const env = (extra: Record<string, string | undefined> = {}) => {
  const e = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_HC: join(dir, "hc"),
    FAKE_HC_DIR: dir,
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    ORQ_GITHUB_REPOS: `acme/app=${checkout}`,
    ORQ_WATCH_RETRY: "0.2",
    ORQ_SERVER: socket,
    ...extra,
  } as Record<string, string | undefined>
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k]
  return e as Record<string, string>
}
const serverEnv = () => ({ ORQ_DATA: join(dir, "server"), ORQ_TRIGGER_TOKEN: TOKEN, ORQ_GITHUB_REPOS: `acme/app=${checkout}` })
const boot = async () => {
  server = await startServer(socket, serverEnv(), undefined, undefined, trig)
}

const watch = (extra: Record<string, string | undefined> = {}) => {
  const p = Bun.spawn([...ORQ, "watch"], { cwd: checkout, env: env(extra), stdout: "pipe", stderr: "pipe" })
  watchers.push(p)
  return p
}

const orq = (args: string[], extra: Record<string, string | undefined> = {}) => {
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: checkout, env: env(extra), stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

let issues = 0
/** An issue of `repo` arrives from GitHub; the task's id. */
const anIssue = async (repo = "acme/app") => {
  const n = ++issues
  const res = await fetch(`http://127.0.0.1:${trig}/github/issues`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      repo,
      issue: { url: `https://github.com/${repo}/issues/${n}`, number: n, title: `Fix thing ${n}` },
      request: "please fix",
    }),
  })
  return ((await res.json()) as { id: string }).id
}
const field = (id: string, name: string) => new RegExp(`^\\s*${name} = (.*)$`, "m").exec(orq(["show", id]).out)?.[1]?.trim()

const hcRuns = () =>
  existsSync(join(dir, "log"))
    ? readFileSync(join(dir, "log"), "utf8")
        .trim()
        .split("\n")
        .filter((c) => c.startsWith("|run "))
    : []

/** Polls `read` until it gives something, or fails after `ms`. */
const eventually = async <T>(read: () => T | undefined | false, ms = 60000): Promise<T> => {
  const deadline = Date.now() + ms
  for (;;) {
    const v = read()
    if (v) return v
    if (Date.now() > deadline) throw new Error("did not happen in time")
    await Bun.sleep(200)
  }
}
const started = (id: string) => () => field(id, "worktree") && field(id, "worktree") !== "null"

beforeEach(async () => {
  issues = 0
  dir = mkdtempSync(join(tmpdir(), "orq-watch-"))
  checkout = join(dir, "proj")
  aRepo(checkout)
  writeFileSync(join(dir, "hc"), FAKE_HC)
  chmodSync(join(dir, "hc"), 0o755)
  writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals: [{ address: "t-proj", where: "proj / 1" }] }))
  writeFileSync(join(dir, "get-t-proj.json"), JSON.stringify({ labels: { "herdr.space": "sp-proj" } }))
  socket = join(dir, "orq.sock")
  trig = 20000 + Math.floor(Math.random() * 10000)
  await boot()
})
afterEach(() => {
  for (const w of watchers.splice(0)) w.kill()
  server?.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("orq watch", () => {
  test("starts the GitHub task waiting at connect and each one added later; a CLI task stays in the backlog", async () => {
    const first = await anIssue()
    const byHand = orq(["new", "by hand"]).out.match(/^(T-\d+)/)?.[1] as string
    watch()
    await eventually(started(first))
    const second = await anIssue()
    await eventually(started(second))
    expect(hcRuns()).toHaveLength(2)
    expect(field(byHand, "worktree")).toBe("null")
  }, 120000)

  test("a task whose repo has no checkout is BLOCKED and watch starts the next one", async () => {
    const lost = await anIssue("acme/other")
    const fine = await anIssue()
    watch()
    await eventually(started(fine))
    expect(field(lost, "status")).toBe("BLOCKED")
    expect(field(lost, "worktree")).toBe("null")
  }, 120000)

  test("watch reconnects after the server is stopped and started again", async () => {
    const w = watch()
    await Bun.sleep(1000)
    server?.kill()
    await server?.exited
    await boot()
    const id = await anIssue()
    await eventually(started(id))
    expect(w.exitCode).toBeNull()
  }, 120000)

  test("two watchers start a task once", async () => {
    const ids = [await anIssue(), await anIssue()]
    watch()
    watch()
    for (const id of ids) await eventually(started(id))
    await Bun.sleep(1500)
    expect(hcRuns()).toHaveLength(2)
  }, 120000)

  test("without ORQ_SERVER it fails with a message", () => {
    const p = Bun.spawnSync([...ORQ, "watch"], { cwd: checkout, env: env({ ORQ_SERVER: undefined }), stdout: "pipe", stderr: "pipe" })
    expect(p.exitCode).not.toBe(0)
    expect(p.stderr.toString()).toContain("orq watch needs a server")
  })
})
