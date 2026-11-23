// The guard's decision: allow or block one tool call in a task session.
// Plain TypeScript: no Effect, no bun:* imports, so any harness can call it.
// The guards stop mistakes. They are not a security boundary.
//
//   G1 protect base   no push/merge/commit on the base branch, no force push, no PR merge
//   G2 secrets        no reading or writing .env*, keys, credential files
//   G3 stay inside    file writes and git writes only inside the task worktree
//   G4 destructive    rm -r / find -delete / git clean / git reset --hard only inside it; no orq clean
//
// Each rule yields the blocks it finds, in order; decide() returns the first one.
import { resolve } from "node:path"
import { simpleCommands } from "./shell.ts"

export interface HookInput {
  readonly tool_name: string
  readonly cwd?: string
  readonly tool_input: Record<string, unknown>
}

export interface GuardEnv {
  /** ORQ_TASK; without it every call is allowed */
  readonly task: string | undefined
  readonly worktree: string | undefined
  readonly base: string
  /** scratch space that is always allowed */
  readonly tmp: string
  readonly home: string
}

export type Guard = "G1" | "G2" | "G3" | "G4"
type Block = { readonly allow: false; readonly guard: Guard; readonly reason: string }
export type Verdict = { readonly allow: true } | Block

/** The current branch of the repository at a directory, or null. */
export type BranchOf = (dir: string) => string | null

const block = (guard: Guard, reason: string): Block => ({ allow: false, guard, reason })

const D = `\\s"'=;|&()<>` // characters that end a path in a command
const SECRET = new RegExp(
  `(^|[/${D}])(\\.env(\\.[A-Za-z0-9_-]+)?|[^/${D}]+\\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)(\\.pub)?|credentials(\\.json)?|\\.netrc|\\.npmrc|\\.pypirc|\\.ssh/[^${D}]*)($|[${D}])`,
)
const SAFE = /\.env\.(example|sample|template)/g

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])
const GIT_WRITES = new Set(
  "commit push merge rebase reset clean checkout switch restore stash cherry-pick revert am tag branch pull".split(" "),
)
const ON_BASE = new Set("commit merge rebase cherry-pick revert am pull push".split(" "))
const FORCE_PUSH = new Set(["--force", "--mirror", "--all"])

export const decide = (input: HookInput, env: GuardEnv, branchOf: BranchOf): Verdict => {
  if (!env.task) return { allow: true }
  const [first] = new Context(input, env, branchOf).blocks().take(1)
  return first ?? { allow: true }
}

class Context {
  private readonly cwd: string
  private readonly wt: string

  constructor(
    private readonly input: HookInput,
    private readonly env: GuardEnv,
    private readonly branchOf: BranchOf,
  ) {
    this.cwd = input.cwd || process.cwd()
    this.wt = resolve(env.worktree ?? this.cwd)
  }

  private str(key: string): string {
    const v = this.input.tool_input[key]
    return typeof v === "string" ? v : ""
  }
  private path(p: string): string {
    return resolve(this.cwd, p.startsWith("~") ? this.env.home + p.slice(1) : p)
  }
  private static inside(p: string, dir: string): boolean {
    return `${p}/`.startsWith(`${dir}/`)
  }
  private allowed(p: string): boolean {
    return Context.inside(p, this.wt) || Context.inside(p, resolve(this.env.tmp))
  }

  *blocks(): Generator<Block> {
    const tool = this.input.tool_name
    yield* this.secrets(tool)
    if (WRITE_TOOLS.has(tool)) {
      const p = this.path(this.str("file_path") || this.str("notebook_path"))
      if (!this.allowed(p)) yield block("G3", `${p} is outside the task worktree ${this.wt}. Work only in the worktree.`)
      return
    }
    if (tool !== "Bash") return
    for (const [cmd = "", ...args] of simpleCommands(this.str("command"))) yield* this.command(cmd, args)
  }

  /** G2, for every tool that names a path or runs a command. */
  private *secrets(tool: string): Generator<Block> {
    const text =
      WRITE_TOOLS.has(tool) || tool === "Read"
        ? this.str("file_path") || this.str("notebook_path")
        : tool === "Grep" || tool === "Glob"
          ? [this.str("path"), this.str("glob"), this.str("pattern")].filter(Boolean).join(" ")
          : tool === "Bash"
            ? this.str("command")
            : ""
    if (SECRET.test(text.replace(SAFE, "")))
      yield block(
        "G2",
        "this touches a secret file (.env, key, credentials). Do not read or write secrets. Use .env.example or ask the user.",
      )
  }

  private *command(cmd: string, args: string[]): Generator<Block> {
    if (cmd === "git") yield* this.git(args)
    if (cmd === "gh" && args[0] === "pr" && args[1] === "merge") yield block("G1", "merging a PR is the user's gate.")
    if (cmd === "gh" && args[0] === "repo" && args[1] === "delete") yield block("G4", "deleting a repository is not allowed.")
    if (cmd === "orq" && args[0] === "clean") yield block("G4", "orq clean removes a worktree and a branch. The user runs it.")
    if (cmd === "rm" && args.some((x) => x === "--recursive" || /^-[a-zA-Z]*[rR]/.test(x))) yield* this.deletes(args)
    if (cmd === "find" && args.includes("-delete")) yield* this.deletes([args[0] && !args[0].startsWith("-") ? args[0] : "."])
  }

  /** G4: what rm -r or find -delete would remove must be inside the worktree. */
  private *deletes(args: string[]): Generator<Block> {
    for (const x of args.filter((a) => !a.startsWith("-"))) {
      if (x.includes("$") || x.includes("`")) yield block("G4", `cannot check '${x}' (a variable). Use a literal path inside the worktree.`)
      const p = this.path(x)
      if (p === this.wt) yield block("G4", "do not delete the worktree itself.")
      if (!this.allowed(p)) yield block("G4", `${p} is outside the task worktree.`)
    }
  }

  /** G1, G3, G4 for git. The specific rules come first, so the message names the real problem. */
  private *git(args: string[]): Generator<Block> {
    let i = 0
    let dir = this.cwd
    for (let flag = args[i]; flag?.startsWith("-"); flag = args[i]) {
      if (flag === "-C") dir = this.path(args[i + 1] ?? ".")
      i += flag === "-C" || flag === "-c" ? 2 : 1
    }
    dir = resolve(dir)
    const sub = args[i] ?? ""
    const rest = args.slice(i + 1)
    const { base } = this.env

    if (sub === "worktree" && ["add", "remove", "move", "prune"].includes(rest[0] ?? ""))
      yield block("G3", `orq manages worktrees. Do not run git worktree ${rest[0]}.`)
    if (ON_BASE.has(sub) && this.branchOf(dir) === base) yield block("G1", `you are on the base branch '${base}'. Work on the task branch.`)
    if (sub === "push")
      for (const x of rest) {
        if (FORCE_PUSH.has(x) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x))
          yield block("G1", `git push ${x} is not allowed. Use --force-with-lease on the task branch only.`)
        if ([base, `+${base}`, `refs/heads/${base}`].includes(x) || x.endsWith(`:${base}`) || x.endsWith(`:refs/heads/${base}`))
          yield block("G1", `pushing to the base branch '${base}' is the user's gate.`)
      }
    if ((sub === "clean" || (sub === "reset" && rest.includes("--hard"))) && !Context.inside(dir, this.wt))
      yield block("G4", `git ${sub} outside the task worktree.`)
    if (GIT_WRITES.has(sub) && !Context.inside(dir, this.wt))
      yield block("G3", `git ${sub} outside the task worktree (${dir}). Work only in ${this.wt}.`)
  }
}
