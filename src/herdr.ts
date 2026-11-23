// herdr-core mechanics: run a task's session in a terminal that stays alive, find it again,
// end it. herdr-core (`hc`) keeps the terminals; the Herdr app and `hc attach`
// show them, on this machine or over SSH.
import { Effect, Schema } from "effect"
import { OrqConfig } from "./config.ts"
import { OrqError } from "./domain.ts"
import { run } from "./proc.ts"

/** The command that starts a task session, inside the sandbox command if one is set (ORQ_SANDBOX).
 * ORQ_* switch on the guard hook (orq guard); ORQ_DATA is for the skills (the archive). Each of `addDirs` (ORQ_ADD_DIRS) is added with --add-dir. */
export const sessionCommand = (
  id: string,
  worktree: string,
  base: string,
  model: string,
  sandbox: string,
  addDirs: string,
  data: string,
) => [
  ...sandbox.split(/\s+/).filter(Boolean),
  "env",
  `ORQ_TASK=${id}`,
  `ORQ_WORKTREE=${worktree}`,
  `ORQ_BASE=${base}`,
  `ORQ_DATA=${data}`,
  "claude",
  "--model",
  model,
  ...addDirs
    .split(":")
    .filter(Boolean)
    .map((dir) => `--add-dir=${dir}`), // one value each: a bare --add-dir would take the prompt as a directory too
  `/orq:task ${id}`,
]

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`)

/** The task's terminal name in herdr-core, which takes lowercase names only: orq-t-0001. */
export const terminalName = (id: string) => `orq-${id.toLowerCase()}`

/** env's exit code when it cannot find the program: hc is not installed. */
const NOT_FOUND = 127

/** `hc …` with no parent terminal: run from inside one (HC_TERMINAL_ID), hc would make the task
 * session its child, ending it with that terminal and typing notes into it. */
const hc = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { hc } = yield* OrqConfig
    return yield* run("env", ["-u", "HC_TERMINAL_ID", hc, ...args])
  })

/** The `hc` failure as an OrqError, with hc's own message (its errors are JSON on stderr). */
const hcError = (what: string, out: { code: number; stderr: string }) => {
  const message = /"message":"((?:[^"\\]|\\.)*)"/.exec(out.stderr)?.[1]?.replaceAll('\\"', '"')
  return new OrqError({ message: `${what}: ${message ?? (out.stderr.trim() || `hc exit ${out.code}`)}` })
}

const Terminals = Schema.fromJsonString(
  Schema.Struct({ terminals: Schema.Array(Schema.Struct({ address: Schema.String, name: Schema.optional(Schema.String) })) }),
)
const decodeTerminals = Schema.decodeUnknownEffect(Terminals)

/** The address (`t7`) of the task's live terminal, if it has one. Without hc, none. */
const findTerminal = (id: string) =>
  Effect.gen(function* () {
    const out = yield* hc(["ls", "--json"])
    if (out.code !== 0) return undefined
    const { terminals } = yield* decodeTerminals(out.stdout).pipe(Effect.orElseSucceed(() => ({ terminals: [] })))
    return terminals.find((t) => t.name === terminalName(id))?.address
  })

/** Start the task's session in a herdr-core terminal, or return the command to run by hand when hc
 * is not there. A session that is already running is left as it is. */
export const openSession = (id: string, worktree: string, base: string) =>
  Effect.gen(function* () {
    const { model, sandbox, addDirs, home } = yield* OrqConfig
    const cmd = sessionCommand(id, worktree, base, model, sandbox, addDirs, home)
    if ((yield* findTerminal(id)) !== undefined) return `${terminalName(id)} is already running (hc attach ${terminalName(id)})`

    const out = yield* hc(["run", "--bg", "--outlive-parent", "--name", terminalName(id), "--cwd", worktree, "--", ...cmd])
    if (out.code === NOT_FOUND)
      return `no herdr-core (hc); start the task with:\n  cd ${shellQuote(worktree)} && ${cmd.map(shellQuote).join(" ")}`
    if (out.code !== 0) return yield* hcError(`cannot start ${terminalName(id)}`, out)
    return `started ${terminalName(id)} in herdr-core (hc attach ${terminalName(id)})`
  })

/** Ends the task's session and removes its terminal, if it has one. */
export const closeSession = (id: string) =>
  Effect.gen(function* () {
    const terminal = yield* findTerminal(id)
    if (terminal === undefined) return `${terminalName(id)}: no session running`
    const killed = yield* hc(["kill", terminal])
    if (killed.code !== 0) return yield* hcError(`cannot end ${terminalName(id)}`, killed)
    yield* hc(["rm", terminal]) // a removed terminal frees its screen and history; the task's files keep what matters
    return `${terminalName(id)}: session ended`
  })
