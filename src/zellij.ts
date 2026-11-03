// zellij mechanics: open a task session in a tab.
import { Effect } from "effect"
import { OrqConfig } from "./config.ts"
import { exec, run } from "./proc.ts"

/** The command that starts a task session. ORQ_* switch on the guard hook (orq guard). */
export const sessionCommand = (id: string, worktree: string, base: string, model: string) => [
  "env", `ORQ_TASK=${id}`, `ORQ_WORKTREE=${worktree}`, `ORQ_BASE=${base}`,
  "claude", "--model", model, `/orqestrai:task ${id}`,
]

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`)

/** Open a tab inside zellij, or in the named session, or return the command to run by hand. */
export const openTab = (id: string, worktree: string, base: string) =>
  Effect.gen(function* () {
    const { session, model } = yield* OrqConfig
    const cmd = sessionCommand(id, worktree, base, model)
    const tab = ["action", "new-tab", "--name", `orq-${id}`, "--cwd", worktree, "--", ...cmd]

    if (process.env.ZELLIJ) {
      yield* exec("zellij", tab)
      return `opened zellij tab orq-${id}`
    }
    const sessions = yield* run("zellij", ["list-sessions", "--short"]).pipe(Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })))
    if (sessions.code === 0 && sessions.stdout.split("\n").includes(session)) {
      yield* exec("zellij", ["--session", session, ...tab])
      return `opened tab orq-${id} in zellij session ${session} (attach: zellij attach ${session})`
    }
    return `no zellij session; start the task with:\n  cd ${shellQuote(worktree)} && ${cmd.map(shellQuote).join(" ")}`
  })
