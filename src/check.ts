// `orq check`: the quality gate. A project is made of components (folders, `components` in
// .orqestrai/config.toml; the whole repository when not set). Each component says how it is
// checked in its own justfile, recipe `check`, the same one CI runs; orq keeps no commands. The
// gate runs `just check` in each component the branch changed: files that differ from where the
// branch left the base branch, committed or not.
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Console, Effect, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { OrqError } from "./domain.ts"
import { baseBranch, topLevel } from "./git.ts"
import { exec, run } from "./proc.ts"

const Components = Schema.Struct({ components: Schema.optional(Schema.Array(Schema.NonEmptyString)) })
const decodeComponents = Schema.decodeUnknownEffect(Components)

const JUSTFILES = ["justfile", "Justfile", ".justfile"]
/** Lines of a failed check's output that the gate shows. */
const TAIL = 30

/** The component folders, relative to the root: each entry of `components` is a folder or a
 * glob of folders ("services/*"). */
export const components = (root: string) =>
  Effect.gen(function* () {
    const file = join(root, ".orqestrai", "config.toml")
    if (!existsSync(file)) return ["."]
    const toml = yield* Effect.try({
      try: () => Bun.TOML.parse(readFileSync(file, "utf8")),
      catch: (e) => new OrqError({ message: `${file}: ${e instanceof Error ? e.message : String(e)}` }),
    })
    const { components } = yield* decodeComponents(toml).pipe(
      Effect.mapError(() => new OrqError({ message: `${file}: components must be a list of folders` })),
    )
    if (components === undefined) return ["."]
    const folders = new Set<string>()
    for (const entry of components) {
      const pattern = entry.replace(/\/+$/, "") || "."
      if (!/[*?[{]/.test(pattern)) folders.add(pattern)
      else
        for (const match of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false }))
          if (statSync(join(root, match)).isDirectory()) folders.add(match)
    }
    return [...folders].sort()
  })

/** The files the branch changed since it left the base branch: commits, the working tree and
 * untracked files. */
const changedFiles = (root: string) =>
  Effect.gen(function* () {
    const base = yield* baseBranch(root)
    const fork = yield* exec("git", ["merge-base", base, "HEAD"], root).pipe(
      Effect.catch(() => exec("git", ["merge-base", `origin/${base}`, "HEAD"], root)),
      Effect.mapError(() => new OrqError({ message: `no common commit with the base branch '${base}'` })),
    )
    const diff = yield* exec("git", ["diff", "--name-only", fork], root)
    const untracked = yield* exec("git", ["ls-files", "--others", "--exclude-standard"], root)
    return [...diff.split("\n"), ...untracked.split("\n")].filter(Boolean)
  })

const contains = (component: string, file: string) => component === "." || file === component || file.startsWith(`${component}/`)

export interface Result {
  readonly component: string
  readonly outcome: "pass" | "fail" | "not configured"
  readonly output: string
}

/** `just check` in one component. One with no justfile is "not configured", not a failure. */
const checkOne = (root: string, component: string) =>
  Effect.gen(function* () {
    const dir = join(root, component)
    if (!JUSTFILES.some((f) => existsSync(join(dir, f))))
      return { component, outcome: "not configured", output: "no justfile" } satisfies Result
    const out = yield* run("just", ["check"], dir)
    const output = `${out.stdout}${out.stderr}`.trimEnd()
    return { component, outcome: out.code === 0 ? "pass" : "fail", output } satisfies Result
  })

/** The gate: `just check` in every component the branch changed (`all`: in every component). */
export const runChecks = (root: string, all = false) =>
  Effect.gen(function* () {
    const folders = yield* components(root)
    const files = all ? [] : yield* changedFiles(root)
    const touched = all ? folders : folders.filter((c) => files.some((f) => contains(c, f)))
    const results: Result[] = []
    for (const component of touched) results.push(yield* checkOne(root, component))
    return results
  })

const report = (r: Result) => {
  if (r.outcome === "pass") return `pass  ${r.component}`
  if (r.outcome === "not configured") return `not configured  ${r.component} (no justfile)`
  return `fail  ${r.component}\n${r.output
    .split("\n")
    .slice(-TAIL)
    .map((l) => `  ${l}`)
    .join("\n")}`
}

export const check = Command.make(
  "check",
  { all: Flag.Boolean("all").pipe(Flag.withDefault(false), Flag.withDescription("every component, not only the changed ones")) },
  ({ all }) =>
    Effect.gen(function* () {
      const results = yield* runChecks(yield* topLevel(), all)
      if (results.length === 0) return yield* Console.log("nothing to check: the branch changed no component")
      for (const r of results) yield* Console.log(report(r))
      const failed = results.filter((r) => r.outcome === "fail").map((r) => r.component)
      if (failed.length > 0) return yield* new OrqError({ message: `check failed: ${failed.join(", ")}` })
    }),
).pipe(Command.withDescription("the quality gate: `just check` in each component the branch changed"))
