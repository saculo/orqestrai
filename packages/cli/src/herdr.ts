// herdr-core mechanics: run a task's session in a terminal that stays alive, find it again,
// end it. herdr-core (`hc`) keeps the terminals; the Herdr app and `hc attach`
// show them, on this machine or over SSH.

import { OrqConfig } from "@orqestrai/core/config.ts"
import { OrqError } from "@orqestrai/core/domain.ts"
import { run } from "@orqestrai/core/proc.ts"
import { Effect, Schema } from "effect"
import { trust } from "./trust/index.ts"

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
 * session its child, ending it with that terminal and typing notes into it. Fence replaces
 * XDG_RUNTIME_DIR, where hc looks for its socket; hc also reads HC_SOCKET, so a session in Fence
 * gets the socket of its terminal (HC_TERMINAL_SOCKET) unless HC_SOCKET is set. */
const hc = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { hc } = yield* OrqConfig
    const socket = process.env.HC_SOCKET ? [] : process.env.HC_TERMINAL_SOCKET ? [`HC_SOCKET=${process.env.HC_TERMINAL_SOCKET}`] : []
    return yield* run("env", ["-u", "HC_TERMINAL_ID", ...socket, hc, ...args])
  })

/** The `hc` failure as an OrqError, with hc's own message (its errors are JSON on stderr). */
const hcError = (what: string, out: { code: number; stderr: string }) => {
  const message = /"message":"((?:[^"\\]|\\.)*)"/.exec(out.stderr)?.[1]?.replaceAll('\\"', '"')
  return new OrqError({ message: `${what}: ${message ?? (out.stderr.trim() || `hc exit ${out.code}`)}` })
}

/** The project's Herdr space has no live terminal: the app has to open it. The task is kept. */
export class SpaceNotOpen extends Schema.TaggedError<SpaceNotOpen>()("SpaceNotOpen", {
  space: Schema.String,
  id: Schema.String,
  message: Schema.String,
}) {}
const spaceNotOpen = (space: string, id: string) =>
  new SpaceNotOpen({
    space,
    id,
    message: `${id}: no session started, Herdr space ${space} is not open; open it in the Herdr app, then run: orq resume ${id}`,
  })

const Terminals = Schema.fromJsonString(
  Schema.Struct({
    terminals: Schema.Array(
      Schema.Struct({ address: Schema.String, name: Schema.optional(Schema.String), where: Schema.optional(Schema.String) }),
    ),
  }),
)
const decodeTerminals = Schema.decodeUnknownEffect(Terminals)

/** The live terminals, or "no hc" (exit 127). Any other failure of `hc ls` is an OrqError. */
const liveTerminals = () =>
  Effect.gen(function* () {
    const out = yield* hc(["ls", "--json"])
    if (out.code === NOT_FOUND) return undefined
    if (out.code !== 0) return yield* hcError("hc ls", out)
    const decoded = yield* decodeTerminals(out.stdout).pipe(
      Effect.mapError(() => new OrqError({ message: "hc ls: its output cannot be read" })),
    )
    return decoded.terminals
  })

const Labels = Schema.fromJsonString(Schema.Struct({ labels: Schema.optional(Schema.Record(Schema.String, Schema.String)) }))
const decodeLabels = Schema.decodeUnknownEffect(Labels)

/** The labels of a terminal (`hc get`). */
const labelsOf = (address: string) =>
  Effect.gen(function* () {
    const out = yield* hc(["get", address, "--json"])
    if (out.code !== 0) return yield* hcError(`hc get ${address}`, out)
    const { labels } = yield* decodeLabels(out.stdout).pipe(
      Effect.mapError(() => new OrqError({ message: `hc get ${address}: its output cannot be read` })),
    )
    return labels ?? {}
  })

/** The Herdr desktop app shows a terminal only in one of its spaces, named by its
 * `herdr.space` label (`hc ls` shows the space's name in `where`: "home / 1"); it opens a tab
 * there for a terminal that has the label and no tab. Only the app creates spaces. The label of
 * the project's space is read from a live terminal in it. No terminal in the space: SpaceNotOpen.
 * Never the label of another space. */
const spaceLabel = (terminals: ReadonlyArray<{ address: string; where?: string | undefined }>, space: string, id: string) =>
  Effect.gen(function* () {
    const inSpace = terminals.find((t) => t.where?.split(" / ")[0] === space)
    if (!inSpace) return yield* spaceNotOpen(space, id)
    const label = (yield* labelsOf(inSpace.address))["herdr.space"]
    if (!label) return yield* new OrqError({ message: `terminal ${inSpace.address} in space ${space} has no herdr.space label` })
    return label
  })

/** Start the task's session in a herdr-core terminal in the project's Herdr `space` (see spaceLabel), or return the command to run by hand when hc
 * is not there. A session that is already running is left as it is, but gets the space's label if it has none. */
export const openSession = (id: string, worktree: string, base: string, space: string) =>
  Effect.gen(function* () {
    const { model, sandbox, addDirs, home } = yield* OrqConfig
    const cmd = sessionCommand(id, worktree, base, model, sandbox, addDirs, home)
    const handCommand = `no herdr-core (hc); start the task with:\n  cd ${shellQuote(worktree)} && ${cmd.map(shellQuote).join(" ")}`
    yield* trust(worktree) // before the space lookup: also for the hand command and a space that is not open
    const terminals = yield* liveTerminals()
    if (terminals === undefined) return handCommand

    const existing = terminals.find((t) => t.name === terminalName(id))
    if (existing !== undefined) {
      const running = `${terminalName(id)} is already running (hc attach ${terminalName(id)})`
      if ((yield* labelsOf(existing.address))["herdr.space"] !== undefined) return running
      const label = yield* spaceLabel(terminals, space, id)
      const labelled = yield* hc(["label", existing.address, `herdr.space=${label}`])
      if (labelled.code !== 0) return yield* hcError(`cannot label ${terminalName(id)}`, labelled)
      return `${terminalName(id)} is running (hc attach ${terminalName(id)}) and now in space ${space}`
    }

    const label = yield* spaceLabel(terminals, space, id)
    const out = yield* hc([
      "run",
      "--bg",
      "--outlive-parent",
      "--name",
      terminalName(id),
      "--label",
      `herdr.space=${label}`,
      "--cwd",
      worktree,
      "--",
      ...cmd,
    ])
    if (out.code === NOT_FOUND) return handCommand
    if (out.code !== 0) return yield* hcError(`cannot start ${terminalName(id)}`, out)
    return `started ${terminalName(id)} in herdr-core (hc attach ${terminalName(id)})`
  })

/** Ends the task's session and removes its terminal, if it has one. */
export const closeSession = (id: string) =>
  Effect.gen(function* () {
    const terminal = (yield* liveTerminals())?.find((t) => t.name === terminalName(id))?.address
    if (terminal === undefined) return `${terminalName(id)}: no session running`
    const killed = yield* hc(["kill", terminal])
    if (killed.code !== 0) return yield* hcError(`cannot end ${terminalName(id)}`, killed)
    yield* hc(["rm", terminal]) // a removed terminal frees its screen and history; the task's files keep what matters
    return `${terminalName(id)}: session ended`
  })
