// zellij mechanics: open a task session in a tab, find it again, type into it.
import { Effect, Schema } from "effect"
import { OrqConfig } from "./config.ts"
import { exec, run } from "./proc.ts"

/** The command that starts a task session, inside the sandbox command if one is set (ORQ_SANDBOX).
 * ORQ_* switch on the guard hook (orq guard). With `resume`, it continues the worktree's last
 * conversation with that message instead of starting the task skill. */
export const sessionCommand = (id: string, worktree: string, base: string, model: string, sandbox: string, resume?: string) => [
  ...sandbox.split(/\s+/).filter(Boolean),
  "env",
  `ORQ_TASK=${id}`,
  `ORQ_WORKTREE=${worktree}`,
  `ORQ_BASE=${base}`,
  "claude",
  "--model",
  model,
  ...(resume === undefined ? [`/orq:task ${id}`] : ["--continue", resume]),
]

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`)

const tabName = (id: string) => `orq-${id}`

/** `zellij action …` in the current session, inside zellij, or else in ORQ_ZELLIJ_SESSION. */
const action = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { session } = yield* OrqConfig
    return yield* exec("zellij", [...(process.env.ZELLIJ ? [] : ["--session", session]), "action", ...args])
  })

const sessionExists = Effect.gen(function* () {
  const { session } = yield* OrqConfig
  const sessions = yield* run("zellij", ["list-sessions", "--short"]).pipe(
    Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
  )
  return sessions.code === 0 && sessions.stdout.split("\n").includes(session)
})

/** The session for the tabs, started in the background if it is not running (the Slack bridge). */
export const ensureSession = Effect.gen(function* () {
  const { session } = yield* OrqConfig
  if (!(yield* sessionExists)) yield* exec("zellij", ["attach", "--create-background", session])
})

/** Open a tab inside zellij, or in the named session, or return the command to run by hand. */
export const openTab = (id: string, worktree: string, base: string, resume?: string) =>
  Effect.gen(function* () {
    const { session, model, sandbox } = yield* OrqConfig
    const cmd = sessionCommand(id, worktree, base, model, sandbox, resume)
    if (!process.env.ZELLIJ && !(yield* sessionExists))
      return `no zellij session; start the task with:\n  cd ${shellQuote(worktree)} && ${cmd.map(shellQuote).join(" ")}`

    // With nobody attached, zellij (0.45) gives a new tab no pane; the pane is added to it then.
    const clients = yield* action(["list-clients"])
    if (clients.split("\n").length > 1) yield* action(["new-tab", "--name", tabName(id), "--cwd", worktree, "--", ...cmd])
    else {
      const tab = yield* action(["new-tab", "--name", tabName(id), "--cwd", worktree])
      yield* action(["new-pane", "--tab-id", tab, "--cwd", worktree, "--", ...cmd])
    }
    return process.env.ZELLIJ
      ? `opened zellij tab ${tabName(id)}`
      : `opened tab ${tabName(id)} in zellij session ${session} (attach: zellij attach ${session})`
  })

const Panes = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ id: Schema.Number, is_plugin: Schema.Boolean, exited: Schema.Boolean, tab_name: Schema.String })),
)
const decodePanes = Schema.decodeUnknownEffect(Panes)

/** The task's running session pane (`terminal_<n>`), if its tab is open. */
const findPane = (id: string) =>
  Effect.gen(function* () {
    if (!process.env.ZELLIJ && !(yield* sessionExists)) return undefined
    const panes = yield* action(["list-panes", "--tab", "--state", "--json"]).pipe(
      Effect.flatMap(decodePanes),
      Effect.orElseSucceed(() => []),
    )
    const pane = panes.find((p) => !p.is_plugin && !p.exited && p.tab_name === tabName(id))
    return pane && `terminal_${pane.id}`
  })

/** Types a message into the task's session and presses Enter, as a paste, so newlines stay in
 * the message. With the tab closed, it opens the session again, continuing its conversation. */
export const sendToTask = (id: string, worktree: string, base: string, text: string) =>
  Effect.gen(function* () {
    const pane = yield* findPane(id)
    if (pane === undefined) return yield* openTab(id, worktree, base, text)
    yield* action(["write-chars", "--pane-id", pane, `\x1b[200~${text}\x1b[201~`])
    yield* action(["write", "--pane-id", pane, "13"])
    return `typed into ${tabName(id)}`
  })
