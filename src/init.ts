// orq init: the one file a project owns, .orqestrai/config.toml (its base branch); the quality
// gate's checks are in the project's AGENTS.md files. The skills, agents and guard hook come from the orq plugin for
// Claude Code (plugin/), installed once per machine, not per project.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { OrqError } from "./domain.ts"

const CHECKS = `
# The quality gate does not read this file: it runs the commands under "## Checks" in the
# AGENTS.md nearest to each file the branch changed (a service's own, or the repository's).
`

/** Writes .orqestrai/config.toml unless it exists; true when it wrote it. */
export const install = (project: string, base: string) =>
  Effect.try({
    try: () => {
      const cfg = join(project, ".orqestrai", "config.toml")
      if (existsSync(cfg)) return false
      mkdirSync(join(project, ".orqestrai"), { recursive: true })
      writeFileSync(cfg, `base_branch = "${base}"\n${CHECKS}`)
      return true
    },
    catch: (e) => new OrqError({ message: `init: ${e instanceof Error ? e.message : String(e)}` }),
  })
