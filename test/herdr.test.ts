// orq's task sessions in herdr-core, against a fake `hc` that logs its calls, lists the terminals
// in terminals.json and exits with the code in send-code (9: the terminal waits for a person).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

const FAKE_HC = `#!/usr/bin/env bash
printf '%s|%s\\n' "\${HC_TERMINAL_ID:-}" "$*" >> "$FAKE_HC_DIR/log"
case "$1" in
  ls) cat "$FAKE_HC_DIR/terminals.json" 2>/dev/null || echo '{"terminals":[]}' ;;
  send) exit "$(cat "$FAKE_HC_DIR/send-code" 2>/dev/null || echo 0)" ;;
esac
`

let dir: string, repo: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}

const orq = (args: string[]) => {
  const env = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_HC: join(dir, "hc"),
    FAKE_HC_DIR: dir,
    HC_TERMINAL_ID: "t9", // orq runs inside a herdr-core terminal, as in a session started by hand
  } as Record<string, string | undefined>
  delete env.ORQ_SANDBOX
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const hcCalls = () => readFileSync(join(dir, "log"), "utf8").trim().split("\n")
const running = () => writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals: [{ address: "t4", name: "orq-T-0001" }] }))

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
    expect(r.out).toContain("started orq-T-0001 in herdr-core (hc attach orq-T-0001)")
    // no HC_TERMINAL_ID: the session would end with the terminal orq ran in
    expect(hcCalls()).toContainEqual(
      expect.stringMatching(
        /^\|run --bg --outlive-parent --name orq-T-0001 --cwd \S+\/T-0001-add-search -- env ORQ_TASK=T-0001 .* claude --model opus \/orq:task T-0001$/,
      ),
    )
  })

  test("orq open leaves a running session as it is", () => {
    orq(["new", "Add search"])
    running()
    expect(orq(["open", "T-0001"]).out).toContain("orq-T-0001 is already running")
    expect(hcCalls().filter((c) => c.startsWith("|run "))).toHaveLength(1)
  })

  test("orq send types into the running session", () => {
    orq(["new", "Add search"])
    running()
    const r = orq(["send", "T-0001", "use the new API\nand keep the old one"])
    expect(r.out).toContain("typed into orq-T-0001")
    expect(readFileSync(join(dir, "log"), "utf8")).toContain("|send t4 use the new API\nand keep the old one\n")
  })

  test("orq send does not type over a permission prompt", () => {
    orq(["new", "Add search"])
    running()
    writeFileSync(join(dir, "send-code"), "9")
    const r = orq(["send", "T-0001", "go on"])
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("orq-T-0001 waits for a permission decision")
  })

  test("orq clean ends the session and removes its terminal", () => {
    orq(["new", "Add search"])
    orq(["state", "T-0001", "triage", "DROPPED"])
    const worktree = /worktree = (.+)/.exec(orq(["show", "T-0001"]).out)?.[1]?.trim() ?? ""
    sh(["git", "add", "-A"], worktree)
    sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "request"], worktree)
    running()
    const r = orq(["clean", "T-0001"])
    expect(r.out).toContain("orq-T-0001: session ended")
    expect(hcCalls()).toEqual(expect.arrayContaining(["|kill t4", "|rm t4"]))
  })
})
