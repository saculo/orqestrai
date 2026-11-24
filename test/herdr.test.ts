// orq's task sessions in herdr-core, against a fake `hc` that logs its calls, lists the terminals
// in terminals.json.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

const FAKE_HC = `#!/usr/bin/env bash
printf '%s|%s\\n' "\${HC_TERMINAL_ID:-}" "$*" >> "$FAKE_HC_DIR/log"
printf '%s\\n' "\${HC_SOCKET:-}" >> "$FAKE_HC_DIR/sockets"
case "$1" in
  ls)
    if [ -f "$FAKE_HC_DIR/ls-fail" ]; then cat "$FAKE_HC_DIR/ls-fail" >&2; exit 1; fi
    cat "$FAKE_HC_DIR/terminals.json" 2>/dev/null || echo '{"terminals":[]}' ;;
  get)
    if [ -f "$FAKE_HC_DIR/get-fail" ]; then cat "$FAKE_HC_DIR/get-fail" >&2; exit 1; fi
    cat "$FAKE_HC_DIR/get-$2.json" 2>/dev/null || exit 1 ;;
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
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    HC_TERMINAL_ID: "t9", // orq runs inside a herdr-core terminal, as in a session started by hand
    ...extra,
  } as Record<string, string | undefined>
  delete env.ORQ_SANDBOX
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const hcCalls = () => readFileSync(join(dir, "log"), "utf8").trim().split("\n")
const hcRuns = () => hcCalls().filter((c) => c.startsWith("|run "))
const sockets = () => readFileSync(join(dir, "sockets"), "utf8").trim().split("\n")

type Terminal = { address: string; name?: string; where?: string }
const terminals: Terminal[] = []
/** A live terminal; `labels` is what `hc get` shows for it. */
const aTerminal = (t: Terminal, labels: Record<string, string> = {}) => {
  terminals.push(t)
  writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals }))
  writeFileSync(join(dir, `get-${t.address}.json`), JSON.stringify({ labels }))
}
/** A live terminal in the Herdr space `space`, whose label is `label`. */
const spaceOpen = (space: string, label: string, address = `t-${space}`) =>
  aTerminal({ address, where: `${space} / 1` }, { "herdr.space": label })
const running = (labels: Record<string, string> = {}) => aTerminal({ address: "t4", name: "orq-t-0001" }, labels)

beforeEach(() => {
  terminals.length = 0
  dir = mkdtempSync(join(tmpdir(), "orq-herdr-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  sh(["git", "init", "-q", "-b", "main"], repo)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo)
  writeFileSync(join(dir, "hc"), FAKE_HC)
  chmodSync(join(dir, "hc"), 0o755)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const NOT_OPEN = /proj/

const claudeFile = () => join(dir, "claude", ".claude.json")
const claudeConfig = () => JSON.parse(readFileSync(claudeFile(), "utf8"))
const worktreeOf = (id: string) => /worktree = (.+)/.exec(orq(["show", id]).out)?.[1]?.trim() ?? ""

describe("task sessions in herdr-core", () => {
  test("orq new starts the session in a terminal named after the task, in its worktree, with no parent", () => {
    spaceOpen("proj", "sp-proj")
    const r = orq(["new", "Add search"])
    expect(r.out).toContain("started orq-t-0001 in herdr-core (hc attach orq-t-0001)")
    // no HC_TERMINAL_ID: the session would end with the terminal orq ran in
    expect(hcCalls()).toContainEqual(
      expect.stringMatching(
        /^\|run --bg --outlive-parent --name orq-t-0001 --label herdr\.space=sp-proj --cwd \S+\/T-0001-add-search -- env ORQ_TASK=T-0001 .* claude --model opus \/orq:task T-0001$/,
      ),
    )
  })

  test("the session opens in the space named by herdr_session, not the one orq runs in", () => {
    mkdirSync(join(repo, ".orqestrai"))
    writeFileSync(join(repo, ".orqestrai", "config.toml"), 'herdr_session = "meal-prep"\n')
    spaceOpen("home", "sp-home", "t9")
    spaceOpen("meal-prep", "sp-meal")
    orq(["new", "x"])
    expect(hcRuns()).toEqual([expect.stringContaining("--label herdr.space=sp-meal ")])
  })

  test("without herdr_session the space is the repo's directory name", () => {
    spaceOpen("home", "sp-home", "t9")
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"])
    expect(hcRuns()).toEqual([expect.stringContaining("--label herdr.space=sp-proj ")])
  })

  test("orq new with the space not open keeps the task and says what to do", () => {
    spaceOpen("home", "sp-home", "t9")
    const r = orq(["new", "x"])
    expect(r.code).not.toBe(0)
    expect(r.out + r.err).toMatch(NOT_OPEN)
    expect(r.out + r.err).toContain("Herdr app")
    expect(r.out + r.err).toContain("orq resume T-0001")
    expect(hcRuns()).toEqual([])
    const shown = orq(["show", "T-0001"]).out
    expect(shown).toContain("T-0001")
    expect(existsSync(/worktree = (.+)/.exec(shown)?.[1]?.trim() ?? "")).toBe(true)
  })

  test("orq resume with the space not open says the same and starts nothing", () => {
    spaceOpen("home", "sp-home", "t9")
    orq(["new", "x"])
    const r = orq(["resume", "T-0001"])
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(NOT_OPEN)
    expect(r.err).toContain("orq resume T-0001")
    expect(hcRuns()).toEqual([])
  })

  test("orq resume starts the session once the space is open", () => {
    orq(["new", "x"])
    spaceOpen("proj", "sp-proj")
    const r = orq(["resume", "T-0001"])
    expect(r.code).toBe(0)
    expect(hcRuns()).toEqual([expect.stringContaining("--label herdr.space=sp-proj ")])
  })

  test.each([
    ["hc ls fails", () => writeFileSync(join(dir, "ls-fail"), '{"message":"core unavailable"}'), "core unavailable"],
    [
      "hc get fails",
      () => {
        spaceOpen("proj", "sp-proj")
        writeFileSync(join(dir, "get-fail"), '{"message":"core unavailable"}')
      },
      "core unavailable",
    ],
    ["hc ls prints what orq cannot read", () => writeFileSync(join(dir, "terminals.json"), "not json"), "cannot be read"],
    [
      "a terminal in the space has no label",
      () => aTerminal({ address: "t5", where: "proj / 1" }),
      "terminal t5 in space proj has no herdr.space label",
    ],
  ])("when %s, orq stops with the reason and starts no session", (_name, given, message) => {
    given()
    const r = orq(["new", "x"])
    expect(r.code).not.toBe(0)
    expect(r.out + r.err).toContain(message)
    expect(hcRuns()).toEqual([])
  })

  test("orq inside a Fence task session passes its terminal's socket to hc", () => {
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"], { HC_TERMINAL_SOCKET: "/run/x.sock", HC_SOCKET: undefined })
    expect(new Set(sockets())).toEqual(new Set(["/run/x.sock"]))
  })

  test("an HC_SOCKET that is set wins over the terminal's socket", () => {
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"], { HC_TERMINAL_SOCKET: "/run/x.sock", HC_SOCKET: "/run/y.sock" })
    expect(new Set(sockets())).toEqual(new Set(["/run/y.sock"]))
  })

  test("orq resume labels a running terminal that has no space label, and starts nothing", () => {
    orq(["new", "x"]) // space not open: only the task
    spaceOpen("proj", "sp-proj")
    running()
    const r = orq(["resume", "T-0001"])
    expect(r.code).toBe(0)
    expect(hcCalls()).toContain("|label t4 herdr.space=sp-proj")
    expect(hcRuns()).toEqual([])
    expect(r.out).toContain("running")
    expect(r.out).toContain("proj")
  })

  test("orq resume leaves a running session that has its space label as it is", () => {
    orq(["new", "x"])
    spaceOpen("proj", "sp-proj")
    running({ "herdr.space": "sp-proj" })
    expect(orq(["resume", "T-0001"]).out).toContain("orq-t-0001 is already running")
    expect(hcCalls().filter((c) => c.startsWith("|label "))).toEqual([])
    expect(hcRuns()).toEqual([])
  })

  test("orq resume leaves a running session labelled with another space as it is", () => {
    orq(["new", "x"])
    spaceOpen("proj", "sp-proj")
    running({ "herdr.space": "sp-other" })
    expect(orq(["resume", "T-0001"]).out).toContain("orq-t-0001 is already running")
    expect(hcCalls().filter((c) => c.startsWith("|label "))).toEqual([])
  })

  test("orq clean ends the session and removes its terminal", () => {
    spaceOpen("proj", "sp-proj")
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

  test("orq new trusts the worktree and keeps the rest of Claude's config", () => {
    mkdirSync(join(dir, "claude"))
    writeFileSync(claudeFile(), '{"numStartups":3,"projects":{"/a":{"hasTrustDialogAccepted":true,"x":1}}}')
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"])
    const config = claudeConfig()
    expect(config.projects[worktreeOf("T-0001")].hasTrustDialogAccepted).toBe(true)
    expect(config.numStartups).toBe(3)
    expect(config.projects["/a"]).toEqual({ hasTrustDialogAccepted: true, x: 1 })
  })

  test("orq new creates Claude's config when there is none", () => {
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"])
    expect(claudeConfig().projects[worktreeOf("T-0001")].hasTrustDialogAccepted).toBe(true)
  })

  test("orq new leaves a Claude config that is not JSON as it is, warns, and starts the session", () => {
    mkdirSync(join(dir, "claude"))
    writeFileSync(claudeFile(), "{not json")
    spaceOpen("proj", "sp-proj")
    const r = orq(["new", "x"])
    expect(r.code).toBe(0)
    expect(r.err).toContain("not valid JSON")
    expect(readFileSync(claudeFile(), "utf8")).toBe("{not json")
    expect(hcRuns()).toHaveLength(1)
  })

  test("orq resume trusts the worktree again, also when the space is not open", () => {
    spaceOpen("home", "sp-home", "t9")
    orq(["new", "x"])
    const wt = worktreeOf("T-0001")
    writeFileSync(claudeFile(), '{"projects":{}}')
    orq(["resume", "T-0001"])
    expect(claudeConfig().projects[wt].hasTrustDialogAccepted).toBe(true)
  })

  test("orq new keeps the mode of an existing Claude config", () => {
    mkdirSync(join(dir, "claude"))
    writeFileSync(claudeFile(), "{}", { mode: 0o600 })
    chmodSync(claudeFile(), 0o600)
    spaceOpen("proj", "sp-proj")
    const old = process.umask(0o002)
    try {
      orq(["new", "x"])
    } finally {
      process.umask(old)
    }
    expect(statSync(claudeFile()).mode & 0o777).toBe(0o600)
  })

  test("orq new creates Claude's config readable by its owner only", () => {
    spaceOpen("proj", "sp-proj")
    const old = process.umask(0o002)
    try {
      orq(["new", "x"])
    } finally {
      process.umask(old)
    }
    expect(statSync(claudeFile()).mode & 0o777).toBe(0o600)
  })

  test("orq new writes a symlinked Claude config at its target and keeps the link", () => {
    mkdirSync(join(dir, "claude"))
    const target = join(dir, "dotfiles.json")
    writeFileSync(target, "{}", { mode: 0o600 })
    symlinkSync(target, claudeFile())
    spaceOpen("proj", "sp-proj")
    orq(["new", "x"])
    expect(lstatSync(claudeFile()).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(target, "utf8")).projects[worktreeOf("T-0001")].hasTrustDialogAccepted).toBe(true)
  })
})
