// orq's task sessions in herdr-core, against a fake `hc` that logs its calls, lists the terminals
// in terminals.json.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

const FAKE_HC = `#!/usr/bin/env bash
printf '%s|%s\\n' "\${HC_TERMINAL_ID:-}" "$*" >> "$FAKE_HC_DIR/log"
case "$1" in
  ls) cat "$FAKE_HC_DIR/terminals.json" 2>/dev/null || echo '{"terminals":[]}' ;;
  get) cat "$FAKE_HC_DIR/get-$2.json" 2>/dev/null || exit 1 ;;
esac
`

let dir: string, repo: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}

const orq = (args: string[], extra: Record<string, string | undefined> = {}) => {
  const env = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_HC: join(dir, "hc"),
    FAKE_HC_DIR: dir,
    HC_TERMINAL_ID: "t9", // orq runs inside a herdr-core terminal, as in a session started by hand
    ...extra,
  } as Record<string, string | undefined>
  delete env.ORQ_SANDBOX
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const hcCalls = () => readFileSync(join(dir, "log"), "utf8").trim().split("\n")
const running = () => writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals: [{ address: "t4", name: "orq-t-0001" }] }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-herdr-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  sh(["git", "init", "-q", "-b", "main"], repo)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo)
  writeFileSync(join(dir, "hc"), FAKE_HC)
  chmodSync(join(dir, "hc"), 0o755)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("task sessions in herdr-core", () => {
  test("orq new starts the session in a terminal named after the task, in its worktree, with no parent", () => {
    const r = orq(["new", "Add search"])
    expect(r.out).toContain("started orq-t-0001 in herdr-core (hc attach orq-t-0001)")
    // no HC_TERMINAL_ID: the session would end with the terminal orq ran in
    expect(hcCalls()).toContainEqual(
      expect.stringMatching(
        /^\|run --bg --outlive-parent --name orq-t-0001 --cwd \S+\/T-0001-add-search -- env ORQ_TASK=T-0001 .* claude --model opus \/orq:task T-0001$/,
      ),
    )
  })

  test("orq new puts the session in the Herdr space of the terminal orq runs in", () => {
    writeFileSync(join(dir, "get-t9.json"), JSON.stringify({ labels: { "herdr.space": "sp1", "herdr.tab": "tb1" } }))
    orq(["new", "Add search"])
    expect(hcCalls()).toContainEqual(
      expect.stringMatching(/^\|run --bg --outlive-parent --name orq-t-0001 --label herdr\.space=sp1 --cwd /),
    )
  })

  test("orq new run from no terminal (orq issues) puts the session in the space of a terminal the app shows", () => {
    writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals: [{ address: "t2" }, { address: "t3", where: "home / 1" }] }))
    writeFileSync(join(dir, "get-t3.json"), JSON.stringify({ labels: { "herdr.space": "sp3" } }))
    orq(["new", "Add search"], { HC_TERMINAL_ID: undefined })
    expect(hcCalls()).toContainEqual(expect.stringMatching(/^\|run .* --label herdr\.space=sp3 --cwd /))
  })

  test("orq resume leaves a running session as it is", () => {
    orq(["new", "Add search"])
    running()
    expect(orq(["resume", "T-0001"]).out).toContain("orq-t-0001 is already running")
    expect(hcCalls().filter((c) => c.startsWith("|run "))).toHaveLength(1)
  })

  test("orq clean ends the session and removes its terminal", () => {
    orq(["new", "Add search"])
    orq(["set-state", "T-0001", "triage", "DROPPED"])
    const worktree = /worktree = (.+)/.exec(orq(["show", "T-0001"]).out)?.[1]?.trim() ?? ""
    sh(["git", "add", "-A"], worktree)
    sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "request"], worktree)
    running()
    const r = orq(["clean", "T-0001"])
    expect(r.out).toContain("orq-t-0001: session ended")
    expect(hcCalls()).toEqual(expect.arrayContaining(["|kill t4", "|rm t4"]))
  })
})
