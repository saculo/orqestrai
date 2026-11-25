// orq: the mechanics of orqestrai. Task ids, state, worktrees, sessions (herdr-core), task files, PR state.
// The workflow lives in skills/. This program does not decide. It only does.

import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { OrqConfig } from "@orqestrai/core/config.ts"
import { Db } from "@orqestrai/core/db.ts"
import { headline, OrqError, STATUSES, STEPS, stamp, TaskType, TEMPLATES } from "@orqestrai/core/domain.ts"
import { Console, Effect, Layer, Option } from "effect"
import { Argument, CliError, Command, Flag } from "effect/cli"
import { clean } from "./clean.ts"
import { syncFilesOrWarn } from "./files.ts"
import { baseBranch, projectSpace, topLevel } from "./git.ts"
import { closeSession, openSession } from "./herdr.ts"
import { install } from "./init.ts"
import { issues } from "./issues.ts"
import { syncMerged } from "./pr.ts"
import { startTask } from "./task.ts"
import { templates } from "./templates.ts"
import { VERSION } from "./version.ts"
import { withState } from "./with-state.ts"

/** The plugin's guard hook and skills start `orq` by name. Without it on PATH they do not run. */
const warnIfNotOnPath = Effect.gen(function* () {
  if (Bun.which("orq")) return
  yield* Console.error("orq: warning: orq is not on PATH, so the plugin's guard hook and skills cannot start it (README, Install)")
})

const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const project = yield* topLevel()
    const wrote = yield* install(project, yield* baseBranch(project))
    yield* Console.log(
      wrote ? ".orqestrai/config.toml: written; the quality gate's checks go in AGENTS.md (## Checks)" : ".orqestrai/config.toml: kept",
    )
    yield* Console.log("skills, agents and the guard hook: claude plugin install orq@orqestrai (once per machine)")
    yield* warnIfNotOnPath
  }),
).pipe(Command.withDescription("set up this project: .orqestrai/config.toml"))

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))

const playbook = Flag.String("playbook").pipe(
  Flag.withSchema(TaskType),
  Flag.optional,
  Flag.withDescription("the playbook the task runs, e.g. feature (skill playbook-feature)"),
)

/** `--origin gh-issue:https://github.com/o/r/issues/1`: the kind, then the reference. */
const Origin = Flag.String("origin").pipe(
  Flag.optional,
  Flag.withDescription("what the task comes from, <kind>:<ref>, e.g. gh-issue:<url> or jira:ABC-12"),
)
const parseOrigin = (origin: string) => {
  const at = origin.indexOf(":")
  if (at <= 0 || at === origin.length - 1)
    return Effect.fail(new OrqError({ message: `--origin ${origin}: expected KIND:REF, e.g. gh-issue:https://github.com/o/r/issues/1` }))
  return Effect.succeed({ kind: origin.slice(0, at), ref: origin.slice(at + 1) })
}

const newTask = Command.make("new", { request: Argument.String("request"), playbook, origin: Origin }, ({ request, playbook, origin }) =>
  Effect.gen(function* () {
    const from = Option.isSome(origin) ? yield* parseOrigin(origin.value) : undefined
    const { task, worktree, session } = yield* startTask(yield* topLevel(), request, {
      playbook: Option.getOrUndefined(playbook),
      ...(from ? { origin: from } : {}),
    })
    yield* Console.log(`${task.id}  ${task.branch}  ${worktree}`)
    yield* warnIfNotOnPath
    if (session.spaceNotOpen) return yield* new OrqError({ message: session.message })
    yield* Console.log(session.message)
  }),
).pipe(Command.withDescription("new task: id, branch, worktree, session (--playbook, --origin)"), withState)

const resume = Command.make("resume", { id }, ({ id }) =>
  Effect.gen(function* () {
    const task = yield* (yield* Db).get(id)
    if (task.worktree === null) return yield* new OrqError({ message: `${id} is not started; run orq start ${id}` })
    if (!existsSync(task.worktree)) return yield* new OrqError({ message: `worktree ${task.worktree} is gone` })
    yield* Console.log(yield* openSession(id, task.worktree, yield* baseBranch(task.repo), yield* projectSpace(task.repo)))
  }),
).pipe(Command.withDescription("start the task's session again if it is not running; it goes on from the recorded step"), withState)

const setState = Command.make(
  "set-state",
  {
    id,
    step: Argument.Literals("step", STEPS).pipe(Argument.withDescription(STEPS.join(" | "))),
    status: Argument.Literals("status", STATUSES).pipe(Argument.withDescription(STATUSES.join(" | "))),
    note: Flag.String("note").pipe(
      Flag.withDefault(""),
      Flag.withDescription("what happened, or the question you wait on (Markdown; its first line is the headline)"),
    ),
    playbook,
  },
  ({ id, step, status, note, playbook }) =>
    Effect.gen(function* () {
      const db = yield* Db
      if (Option.isSome(playbook)) yield* db.setType(id, playbook.value)
      // a longer note is a message: the headline is the state note, the whole text is kept for the dashboard
      const message = note.includes("\n") || status === "WAITING FOR ME" || status === "BLOCKED" ? note : undefined
      yield* db.setState(id, step, status, headline(note), message || undefined)
      const task = yield* db.get(id)
      if (step === "ship") yield* syncMerged([task])
      yield* syncFilesOrWarn(task)
    }),
).pipe(Command.withDescription("record the task's step and status (--note, --playbook); its files go to the server too"), withState)

const show = Command.make("show", { id }, ({ id }) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* syncMerged([yield* db.get(id)])
    const task = yield* db.get(id)
    const fields = Object.entries(task).map(([k, v]) => [k, v instanceof Date ? stamp(v) : String(v)] as const)
    const width = Math.max(...fields.map(([k]) => k.length))
    for (const [k, v] of fields) yield* Console.log(`${k.padStart(width)} = ${v}`)
    for (const l of yield* db.links(id)) yield* Console.log(`link ${l.kind} ${l.ref} (${l.role})`)
    yield* Console.log("")
    for (const e of (yield* db.events(id, 12)).filter((e) => e.kind !== "message").slice(0, 10))
      yield* Console.log(`${stamp(e.at)}  ${e.kind.padEnd(22)}  ${e.detail ?? ""}`)
  }),
).pipe(Command.withDescription("one task and its last events"), withState)

const ls = Command.make("ls", {}, () =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* syncMerged(yield* db.list)
    for (const t of yield* db.list)
      yield* Console.log(`${t.id}  ${t.step.padEnd(6)}  ${t.status.padEnd(14)}  ${t.title.slice(0, 50).padEnd(50)}  ${stamp(t.updated_at)}`)
  }),
).pipe(Command.withDescription("all tasks"), withState)

const cleanTask = Command.make("clean", { id }, ({ id }) =>
  Effect.gen(function* () {
    for (const line of yield* clean(id)) yield* Console.log(line)
    yield* Console.log(yield* closeSession(id))
  }),
).pipe(
  Command.withDescription("end a merged or dropped task's session, remove its worktree and branch; the task stays in orq ls"),
  withState,
)

const createArtifact = Command.make("create-artifact", { id, name: Argument.Literals("name", TEMPLATES) }, ({ id, name }) =>
  Effect.gen(function* () {
    const out = join(yield* topLevel(), ".orqestrai", "tasks", id, `${name}.md`)
    if (!existsSync(dirname(out))) return yield* new OrqError({ message: `no task folder for ${id} here; are you in its worktree?` })
    if (existsSync(out)) return yield* new OrqError({ message: `${out} exists; edit it instead` })
    writeFileSync(out, templates[name].replaceAll("{{id}}", id))
    yield* Console.log(out)
  }),
).pipe(Command.withDescription("a task file (BRIEF, SPEC, VERIFY, …) from its template"))

const orq = Command.make("orq").pipe(
  Command.withDescription("orqestrai mechanics. The workflow is in the skills."),
  Command.withSubcommands([init, newTask, resume, ls, show, setState, createArtifact, cleanTask, issues]),
)

const AppLayer = OrqConfig.layer.pipe(Layer.provideMerge(BunServices.layer))

Command.run(orq, { version: VERSION }).pipe(
  Effect.tapError((e) => (CliError.isCliError(e) ? Effect.void : Console.error(`orq: ${e.message}`))),
  Effect.provide(AppLayer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
