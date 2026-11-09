// Git mechanics: find the repository, the base branch, create worktrees.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Option, Schema } from "effect"
import { OrqError } from "./domain.ts"
import { exec, run } from "./proc.ts"

export const topLevel = (cwd?: string) =>
  exec("git", ["rev-parse", "--show-toplevel"], cwd).pipe(Effect.mapError(() => new OrqError({ message: "not in a git repository" })))

/** The part of .orqestrai/config.toml that orq reads; the rest is for the skills. */
const ProjectConfig = Schema.Struct({ base_branch: Schema.optional(Schema.NonEmptyString) })
const readProjectConfig = Schema.decodeUnknownOption(ProjectConfig)

/** base_branch from .orqestrai/config.toml, else origin's HEAD, else "main". */
export const baseBranch = (root: string) =>
  Effect.gen(function* () {
    const file = join(root, ".orqestrai", "config.toml")
    const configured = existsSync(file)
      ? yield* Effect.try({
          try: () => Bun.TOML.parse(readFileSync(file, "utf8")),
          catch: (e) => new OrqError({ message: `${file}: ${e instanceof Error ? e.message : String(e)}` }),
        }).pipe(Effect.map((toml) => readProjectConfig(toml).pipe(Option.flatMapNullishOr((c) => c.base_branch))))
      : Option.none()
    if (Option.isSome(configured)) return configured.value
    const origin = yield* run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root)
    return origin.code === 0 ? origin.stdout.trim().replace(/^origin\//, "") : "main"
  })

export const requireRef = (root: string, ref: string) =>
  run("git", ["rev-parse", "--verify", "--quiet", ref], root).pipe(
    Effect.flatMap((o) => (o.code === 0 ? Effect.void : Effect.fail(new OrqError({ message: `base branch '${ref}' not found` })))),
  )

export const addWorktree = (root: string, branch: string, path: string, base: string) =>
  exec("git", ["worktree", "add", "--quiet", "-b", branch, path, base], root)
