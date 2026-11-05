// The guard's decision: allow or block one tool call in a task session.
// Plain TypeScript: no Effect, no bun:* imports, so any harness can call it.
// The guards stop mistakes. They are not a security boundary.
//
//   G1 protect base   no push/merge/commit on the base branch, no force push, no PR merge
//   G2 secrets        no reading or writing .env*, keys, credential files
//   G3 stay inside    file writes and git writes only inside the task worktree
//   G4 destructive    rm -r / find -delete / git clean / git reset --hard only inside it; no orq clean
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
export type Verdict = { readonly allow: true } | { readonly allow: false; readonly guard: Guard; readonly reason: string }

/** The current branch of the repository at a directory, or null. */
export type BranchOf = (dir: string) => string | null

class Block {
  constructor(
    readonly guard: Guard,
    readonly reason: string,
  ) {}
}
const block = (guard: Guard, reason: string): never => {
  throw new Block(guard, reason)
}

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

export const decide = (input: HookInput, env: GuardEnv, branchOf: BranchOf): Verdict => {
  if (!env.task) return { allow: true }
  try {
    check(input, env, branchOf)
    return { allow: true }
  } catch (e) {
    if (e instanceof Block) return { allow: false, guard: e.guard, reason: e.reason }
    throw e
  }
}

const check = (input: HookInput, env: GuardEnv, branchOf: BranchOf) => {
  const cwd = input.cwd || process.cwd()
  const wt = resolve(env.worktree ?? cwd)
  const str = (k: string) => (typeof input.tool_input[k] === "string" ? (input.tool_input[k] as string) : "")
  const path = (p: string) => resolve(cwd, p.startsWith("~") ? env.home + p.slice(1) : p)
  const inside = (p: string, dir: string) => `${p}/`.startsWith(`${dir}/`)
  const allowedPath = (p: string) => inside(p, wt) || inside(p, resolve(env.tmp))

  // G2: secrets, for every tool that names a path or runs a command
  const secrets = (text: string) => {
    if (SECRET.test(text.replace(SAFE, "")))
      block("G2", "this touches a secret file (.env, key, credentials). Do not read or write secrets. Use .env.example or ask the user.")
  }
  const tool = input.tool_name
  if (WRITE_TOOLS.has(tool) || tool === "Read") secrets(str("file_path") || str("notebook_path"))
  if (tool === "Grep" || tool === "Glob") secrets([str("path"), str("glob"), str("pattern")].filter(Boolean).join(" "))
  if (tool === "Bash") secrets(str("command"))

  // G3: file writes stay inside the worktree
  if (WRITE_TOOLS.has(tool)) {
    const p = path(str("file_path") || str("notebook_path"))
    if (!allowedPath(p)) block("G3", `${p} is outside the task worktree ${wt}. Work only in the worktree.`)
    return
  }
  if (tool !== "Bash") return

  // G1, G3, G4 for shell commands
  const rmTargets = (guard: Guard, args: string[]) => {
    for (const x of args) {
      if (x.startsWith("-")) continue
      if (x.includes("$") || x.includes("`")) block(guard, `cannot check '${x}' (a variable). Use a literal path inside the worktree.`)
      const p = path(x)
      if (p === wt) block(guard, "do not delete the worktree itself.")
      if (!allowedPath(p)) block(guard, `${p} is outside the task worktree.`)
    }
  }

  const git = (a: string[]) => {
    let i = 1
    let gdir = cwd
    for (let flag = a[i]; flag?.startsWith("-"); flag = a[i]) {
      if (flag === "-C") gdir = path(a[i + 1] ?? ".")
      i += flag === "-C" || flag === "-c" ? 2 : 1
    }
    gdir = resolve(gdir)
    const sub = a[i] ?? ""
    const rest = a.slice(i + 1)

    if (sub === "worktree" && ["add", "remove", "move", "prune"].includes(rest[0] ?? ""))
      block("G3", `orq manages worktrees. Do not run git worktree ${rest[0]}.`)
    // The specific rules first, so the message names the real problem; then the general G3.
    if (ON_BASE.has(sub) && branchOf(gdir) === env.base) block("G1", `you are on the base branch '${env.base}'. Work on the task branch.`)

    if (sub === "push") {
      const b = env.base
      for (const x of rest) {
        if (["--force", "--mirror", "--all"].includes(x) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x))
          block("G1", `git push ${x} is not allowed. Use --force-with-lease on the task branch only.`)
        if (x === b || x === `+${b}` || x === `refs/heads/${b}` || x.endsWith(`:${b}`) || x.endsWith(`:refs/heads/${b}`))
          block("G1", `pushing to the base branch '${b}' is the user's gate.`)
      }
    }
    if ((sub === "clean" || (sub === "reset" && rest.includes("--hard"))) && !inside(gdir, wt))
      block("G4", `git ${sub} outside the task worktree.`)
    if (GIT_WRITES.has(sub) && !inside(gdir, wt)) block("G3", `git ${sub} outside the task worktree (${gdir}). Work only in ${wt}.`)
  }

  for (const [cmd, ...args] of simpleCommands(str("command"))) {
    if (cmd === "git") git([cmd, ...args])
    if (cmd === "gh") {
      if (args[0] === "pr" && args[1] === "merge") block("G1", "merging a PR is the user's gate.")
      if (args[0] === "repo" && args[1] === "delete") block("G4", "deleting a repository is not allowed.")
    }
    if (cmd === "orq" && args[0] === "clean") block("G4", "orq clean removes a worktree and a branch. The user runs it.")
    if (cmd === "rm" && args.some((x) => x === "--recursive" || /^-[a-zA-Z]*[rR]/.test(x))) rmTargets("G4", args)
    if (cmd === "find" && args.includes("-delete")) rmTargets("G4", [args[0] && !args[0].startsWith("-") ? args[0] : "."])
  }
}
