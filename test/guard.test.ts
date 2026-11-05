// The guard through its seams: decide() for each rule, and `orq guard` as Claude Code calls it.
// /scratch stands for the allowed scratch folder, because the test repo itself is in /tmp.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { decide, type GuardEnv, type HookInput } from "../src/guard/decide.ts"
import { gitBranch } from "../src/guard/main.ts"

let T: string, WT: string, MAIN: string, env: GuardEnv

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}

beforeAll(() => {
  T = mkdtempSync(join(tmpdir(), "orq-guard-"))
  MAIN = join(T, "repo")
  WT = join(T, "wt")
  sh(["git", "init", "-q", "-b", "main", MAIN], T)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], MAIN)
  sh(["git", "worktree", "add", "-q", "-b", "orq/T-0001-x", WT, "main"], MAIN)
  env = { task: "T-0001", worktree: WT, base: "main", tmp: "/scratch", home: "/home/u" }
})
afterAll(() => rmSync(T, { recursive: true, force: true }))

const verdict = (tool: string, toolInput: Record<string, unknown>, cwd = WT) =>
  decide({ tool_name: tool, cwd, tool_input: toolInput } satisfies HookInput, env, gitBranch)
const guardOf = (tool: string, toolInput: Record<string, unknown>, cwd?: string) => {
  const v = verdict(tool, toolInput, cwd)
  return v.allow ? "allow" : v.guard
}
const bash = (command: string, cwd?: string) => guardOf("Bash", { command }, cwd)

describe("outside a task session", () => {
  test("allows everything", () => {
    const v = decide(
      { tool_name: "Bash", cwd: "/", tool_input: { command: "git push origin main --force" } },
      { ...env, task: undefined },
      gitBranch,
    )
    expect(v.allow).toBe(true)
  })
})

describe("G1 protect the base branch", () => {
  test.each([
    ["push to main", "git push origin main"],
    ["push HEAD:main", "git push origin HEAD:main"],
    ["force push", "git push --force origin orq/T-0001-x"],
    ["-f push", "git push -f"],
    ["-fu push", "git push -fu origin orq/T-0001-x"],
    ["gh pr merge", "gh pr merge 12 --squash"],
    ["push inside bash -c", `bash -c "git push origin main"`],
    ["push on a second line", "echo ok\ngit push origin main"],
  ])("blocks %s", (_, cmd) => expect(bash(cmd)).toBe("G1"))

  test("blocks a commit in the main checkout", () => expect(bash("git commit -m x", MAIN)).toBe("G1"))

  test.each([
    ["push task branch", "git push -u origin orq/T-0001-x"],
    ["force-with-lease", "git push --force-with-lease origin orq/T-0001-x"],
    ["gh pr create", "gh pr create --fill"],
    ["commit in worktree", "git add a.txt && git commit -m 'feat(T-0001): x'"],
  ])("allows %s", (_, cmd) => expect(bash(cmd)).toBe("allow"))
})

describe("G2 secrets", () => {
  test.each([
    ["read .env", "Read", { file_path: ".env" }],
    ["read nested .env", "Read", { file_path: "app/.env.local" }],
    ["read key", "Read", { file_path: "/home/u/.ssh/id_ed25519" }],
    ["grep in .env", "Grep", { pattern: "TOKEN", path: ".env" }],
  ])("blocks %s", (_, tool, input) => expect(guardOf(tool, input)).toBe("G2"))

  test.each([
    ["read .env.example", "Read", { file_path: ".env.example" }],
    ["read source", "Read", { file_path: "src/environment.ts" }],
  ])("allows %s", (_, tool, input) => expect(guardOf(tool, input)).toBe("allow"))

  test.each([
    ["cat .env", "cat .env"],
    ["source .env", "source ./.env && npm start"],
  ])("blocks %s", (_, cmd) => expect(bash(cmd)).toBe("G2"))

  test.each([
    ["cp example", "cp .env.example /scratch/x"],
    ["a word that starts with env", "echo environment"],
  ])("allows %s", (_, cmd) => expect(bash(cmd)).toBe("allow"))
})

describe("G3 stay inside the worktree", () => {
  test.each([
    ["write main checkout", "Write", () => ({ file_path: join(MAIN, "a.ts"), content: "" })],
    ["edit home file", "Edit", () => ({ file_path: "/home/u/.bashrc", old_string: "a", new_string: "b" })],
    ["write via ~", "Write", () => ({ file_path: "~/notes.md", content: "" })],
  ])("blocks %s", (_, tool, input) => expect(guardOf(tool, input())).toBe("G3"))

  test.each([
    ["write in worktree", "Write", () => ({ file_path: join(WT, "src/a.ts"), content: "" })],
    ["write relative", "Write", () => ({ file_path: "src/a.ts", content: "" })],
    ["write tmp", "Write", () => ({ file_path: "/scratch/x.txt", content: "" })],
  ])("allows %s", (_, tool, input) => expect(guardOf(tool, input())).toBe("allow"))

  test("blocks git -C on the main checkout", () => expect(bash(`git -C ${MAIN} checkout -b y`)).toBe("G3"))
  test("blocks git worktree add", () => expect(bash("git worktree add ../x")).toBe("G3"))
  test("allows a read-only git command outside", () => expect(bash(`git -C ${MAIN} status`)).toBe("allow"))
})

describe("G4 destructive commands", () => {
  test.each([
    ["rm -rf home", "rm -rf ~/projects"],
    ["rm -rf parent", "rm -rf ../"],
    ["rm worktree root", "rm -rf ."],
    ["rm variable", 'rm -rf "$DIR"'],
    ["find -delete out", "find /home/u -name '*.log' -delete"],
    ["rm -rf inside sh -c", `sh -c 'rm -rf /home/u/projects'`],
    ["orq clean", "orq clean T-0001"],
  ])("blocks %s", (_, cmd) => expect(bash(cmd)).toBe("G4"))

  test("blocks git clean outside", () => expect(bash(`git -C ${MAIN} clean -fdx`)).toBe("G4"))

  test.each([
    ["rm -rf build", "rm -rf build node_modules"],
    ["rm one file", "rm /home/u/x.txt"],
    ["rm -rf tmp", "rm -rf /scratch/orq-test"],
    ["reset --hard in", "git reset --hard HEAD"],
  ])("allows %s", (_, cmd) => expect(bash(cmd)).toBe("allow"))
})

describe("orq guard, as Claude Code calls it", () => {
  const ORQ = resolve(import.meta.dir, "..", "bin", "orq")
  const run = (input: unknown, extraEnv: Record<string, string> = {}) => {
    const e = { ...process.env, ...extraEnv } as Record<string, string | undefined>
    if (!extraEnv.ORQ_TASK) delete e.ORQ_TASK
    const p = Bun.spawnSync([ORQ, "guard"], { stdin: Buffer.from(JSON.stringify(input)), env: e, stdout: "pipe", stderr: "pipe" })
    return { code: p.exitCode, err: p.stderr.toString() }
  }
  const session = () => ({ ORQ_TASK: "T-0001", ORQ_WORKTREE: WT, ORQ_BASE: "main", ORQ_TMP: "/scratch" })

  test("exits 0 outside a task session", () => {
    expect(run({ tool_name: "Bash", cwd: "/", tool_input: { command: "git push origin main" } }).code).toBe(0)
  })

  test("exits 2 with the reason when it blocks", () => {
    const r = run({ tool_name: "Bash", cwd: WT, tool_input: { command: "git push origin main" } }, session())
    expect(r.code).toBe(2)
    expect(r.err).toContain("orqestrai guard G1:")
  })

  test("exits 0 when it allows", () => {
    expect(run({ tool_name: "Bash", cwd: WT, tool_input: { command: "git status" } }, session()).code).toBe(0)
  })

  test("blocks input it cannot read, in a task session", () => {
    const p = Bun.spawnSync([ORQ, "guard"], { stdin: Buffer.from("not json"), env: { ...process.env, ...session() }, stderr: "pipe" })
    expect(p.exitCode).toBe(2)
  })
})
