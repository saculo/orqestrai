// orq init: the one file a project owns, .orqestrai/config.toml (its base branch and its
// components, which the quality gate checks). The skills, agents and guard hook come from the orq plugin for
// Claude Code (plugin/), installed once per machine, not per project.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { OrqError } from "./domain.ts"

const COMPONENTS = `
# The quality gate (orq check) runs \`just check\` in each component the branch changed: a
# component is a folder with a justfile whose recipe check is all its checks, as CI runs them.
# Folders or globs; without this line the whole repository is one component.
# components = ["api", "web", "services/*"]
`

/** Writes .orqestrai/config.toml unless it exists; true when it wrote it. */
export const install = (project: string, base: string) =>
  Effect.try({
    try: () => {
      const cfg = join(project, ".orqestrai", "config.toml")
      if (existsSync(cfg)) return false
      mkdirSync(join(project, ".orqestrai"), { recursive: true })
      writeFileSync(cfg, `base_branch = "${base}"\n${COMPONENTS}`)
      return true
    },
    catch: (e) => new OrqError({ message: `init: ${e instanceof Error ? e.message : String(e)}` }),
  })
