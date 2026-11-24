// Git mechanics: find the repository, the base branch, create worktrees.

import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { OrqError } from "@orqestrai/core/domain.ts"
import { exec, run } from "@orqestrai/core/proc.ts"
import { Effect, Option, Schema } from "effect"

export const topLevel = (cwd?: string) =>
  exec("git", ["rev-parse", "--show-toplevel"], cwd).pipe(Effect.mapError(() => new OrqError({ message: "not in a git repository" })))

/** The part of .orqestrai/config.toml that orq reads; the rest is for the skills. */
const ProjectConfig = Schema.Struct({
  base_branch: Schema.optional(Schema.NonEmptyString),
  herdr_session: Schema.optional(Schema.NonEmptyString), // the Herdr space its task terminals open in
})
const readProjectConfig = Schema.decodeUnknownOption(ProjectConfig)

/** One key of .orqestrai/config.toml, if the file sets it. */
const projectKey = (root: string, key: keyof typeof ProjectConfig.Type) =>
  Effect.gen(function* () {
    const file = join(root, ".orqestrai", "config.toml")
    if (!existsSync(file)) return Option.none<string>()
    const toml = yield* Effect.try({
      try: () => Bun.TOML.parse(readFileSync(file, "utf8")),
      catch: (e) => new OrqError({ message: `${file}: ${e instanceof Error ? e.message : String(e)}` }),
    })
    return readProjectConfig(toml).pipe(Option.flatMapNullishOr((c) => c[key]))
  })

/** The project's Herdr space: herdr_session from .orqestrai/config.toml, else the repo's directory name. */
export const projectSpace = (root: string) => projectKey(root, "herdr_session").pipe(Effect.map(Option.getOrElse(() => basename(root))))

/** base_branch from .orqestrai/config.toml, else origin's HEAD, else "main". */
export const baseBranch = (root: string) =>
  Effect.gen(function* () {
    const configured = yield* projectKey(root, "base_branch")
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
