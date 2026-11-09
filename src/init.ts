// orq init: the one file a project owns, .orqestrai/config.toml (its base branch and the quality
// gate's commands). The skills, agents, guard hook and MCP tools come from the orq plugin for
// Claude Code (plugin/), installed once per machine, not per project.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { OrqError } from "./domain.ts"

const COMMANDS = `
# The quality gate in verify runs these, in this order. A command not set is skipped
# and reported as "not configured"; it never fails the gate.
[commands]
# types = "bun run check"
# lint = "bunx biome ci ."
# test = "bun test"
# e2e = "bun test e2e/"   # run by the verifier against the app in a verify slot, not by the gate

# The project's e2e module. The verifier writes and owns these tests; impl never changes them.
[e2e]
# dir = "e2e/"
`

/** Writes .orqestrai/config.toml unless it exists; true when it wrote it. */
export const install = (project: string, base: string) =>
  Effect.try({
    try: () => {
      const cfg = join(project, ".orqestrai", "config.toml")
      if (existsSync(cfg)) return false
      mkdirSync(join(project, ".orqestrai"), { recursive: true })
      writeFileSync(cfg, `base_branch = "${base}"\n${COMMANDS}`)
      return true
    },
    catch: (e) => new OrqError({ message: `init: ${e instanceof Error ? e.message : String(e)}` }),
  })
