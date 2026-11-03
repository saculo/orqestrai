// `orq guard`: the PreToolUse hook for Claude Code. bin/orq starts this file directly,
// without the Effect CLI, because the hook runs before every tool call and must start fast.
// Exit 2 blocks the call; the message on stderr goes back to the agent.
import { spawnSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { type BranchOf, decide, type HookInput } from "./decide.ts"

export const gitBranch: BranchOf = (dir) => {
  const p = spawnSync("git", ["-C", dir, "branch", "--show-current"], { encoding: "utf8" })
  return p.status === 0 ? p.stdout.trim() : null
}

const main = async () => {
  const raw = await new Response(Bun.stdin.stream()).text() // read stdin first, also when we allow at once
  const env = {
    task: process.env.ORQ_TASK || undefined,
    worktree: process.env.ORQ_WORKTREE || undefined,
    base: process.env.ORQ_BASE || "main",
    tmp: process.env.ORQ_TMP || tmpdir(),
    home: homedir(),
  }
  if (!env.task) process.exit(0)

  let input: HookInput
  try {
    input = JSON.parse(raw) as HookInput
    if (typeof input.tool_name !== "string" || typeof input.tool_input !== "object") throw new Error("not a tool call")
  } catch (e) {
    console.error(`orqestrai guard: cannot read the hook input (${String(e)}); blocking to be safe.`)
    process.exit(2)
  }

  const v = decide(input, env, gitBranch)
  if (!v.allow) {
    console.error(`orqestrai guard ${v.guard}: ${v.reason}`)
    process.exit(2)
  }
}

if (import.meta.main) await main()
