// Git mechanics: find the repository, the base branch, create worktrees.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { OrqError } from "./domain.ts"
import { exec, run } from "./proc.ts"

export const topLevel = (cwd?: string) =>
  exec("git", ["rev-parse", "--show-toplevel"], cwd).pipe(Effect.mapError(() => new OrqError({ message: "not in a git repository" })))

/** base_branch from .orqestrai/config.toml, else origin's HEAD, else "main". */
export const baseBranch = (root: string) =>
  Effect.gen(function* () {
    const cfg = join(root, ".orqestrai", "config.toml")
    if (existsSync(cfg)) {
      const m = /^base_branch\s*=\s*"([^"]+)"/m.exec(readFileSync(cfg, "utf8"))
      if (m?.[1]) return m[1]
    }
    const origin = yield* run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root)
    return origin.code === 0 ? origin.stdout.trim().replace(/^origin\//, "") : "main"
  })

export const requireRef = (root: string, ref: string) =>
  run("git", ["rev-parse", "--verify", "--quiet", ref], root).pipe(
    Effect.flatMap((o) => (o.code === 0 ? Effect.void : Effect.fail(new OrqError({ message: `base branch '${ref}' not found` })))),
  )

export const addWorktree = (root: string, branch: string, path: string, base: string) =>
  exec("git", ["worktree", "add", "--quiet", "-b", branch, path, base], root)
