// orq: the mechanics of orqestrai. Task ids, state, worktrees, zellij tabs, task files, PR state.
// The workflow lives in skills/. This program does not decide. It only does.

import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
import { Argument, CliError, Command } from "effect/cli"
import { bridge } from "./bridge.ts"
import { clean } from "./clean.ts"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { LINK_ROLES, OrqError, STATUSES, STEPS, stamp, TEMPLATES } from "./domain.ts"
import { baseBranch, topLevel } from "./git.ts"
import { install } from "./init.ts"
import { syncMerged } from "./pr.ts"
import { serve } from "./server.ts"
import { slot } from "./slot-cli.ts"
import { withState } from "./state.ts"
import { startTask } from "./task.ts"
import { templates } from "./templates.ts"
import { VERSION } from "./version.ts"
import { openTab, sendToTask } from "./zellij.ts"

/** The plugin's guard hook and skills start `orq` by name. Without it on PATH they do not run. */
const warnIfNotOnPath = Effect.gen(function* () {
  if (Bun.which("orq")) return
  yield* Console.error("orq: warning: orq is not on PATH, so the plugin's guard hook and skills cannot start it (README, Install)")
})

const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const project = yield* topLevel()
    const wrote = yield* install(project, yield* baseBranch(project))
    yield* Console.log(wrote ? ".orqestrai/config.toml: written; set the quality gate's commands in it" : ".orqestrai/config.toml: kept")
    yield* Console.log("skills, agents and the guard hook: claude plugin install orq@orqestrai (once per machine)")
    yield* warnIfNotOnPath
  }),
).pipe(Command.withDescription("set up this project: .orqestrai/config.toml"))

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))

const newTask = Command.make("new", { request: Argument.String("request") }, ({ request }) =>
  Effect.gen(function* () {
    const { task, tab } = yield* startTask(yield* topLevel(), request)
    yield* Console.log(`${task.id}  ${task.branch}  ${task.worktree}`)
    yield* Console.log(tab)
    yield* warnIfNotOnPath
  }),
).pipe(Command.withDescription("new task: id, branch, worktree, zellij tab"), withState)

const open = Command.make("open", { id }, ({ id }) =>
  Effect.gen(function* () {
    const task = yield* (yield* Db).get(id)
    if (!existsSync(task.worktree)) return yield* new OrqError({ message: `worktree ${task.worktree} is gone` })
    yield* Console.log(yield* openTab(id, task.worktree, yield* baseBranch(task.repo)))
  }),
).pipe(Command.withDescription("open the task's tab again (after a restart)"), withState)

const state = Command.make(
  "state",
  {
    id,
    step: Argument.Literals("step", STEPS).pipe(Argument.withDescription(STEPS.join(" | "))),
    status: Argument.Literals("status", STATUSES).pipe(Argument.withDescription(STATUSES.join(" | "))),
    note: Argument.String("note").pipe(Argument.withDefault("")),
  },
  ({ id, step, status, note }) =>
    Effect.gen(function* () {
      yield* (yield* Db).setState(id, step, status, note)
    }),
).pipe(Command.withDescription("record step and status"), withState)

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
    for (const e of yield* db.events(id, 10)) yield* Console.log(`${stamp(e.at)}  ${e.kind.padEnd(22)}  ${e.detail ?? ""}`)
  }),
).pipe(Command.withDescription("one task and its last events"), withState)

const link = Command.make(
  "link",
  {
    id,
    kind: Argument.String("kind").pipe(Argument.withDescription("e.g. gh-issue, jira, slack-thread, gh-pr")),
    ref: Argument.String("ref").pipe(Argument.withDescription("the reference in that system")),
    role: Argument.Literals("role", LINK_ROLES).pipe(Argument.withDefault("related" as const)),
  },
  ({ id, kind, ref, role }) =>
    Effect.gen(function* () {
      yield* (yield* Db).link(id, kind, ref, role)
    }),
).pipe(Command.withDescription("link the task to an outside reference (origin | related)"), withState)

const ask = Command.make("ask", { id, text: Argument.String("text") }, ({ id, text }) =>
  Effect.gen(function* () {
    const db = yield* Db
    const task = yield* db.get(id)
    yield* db.setState(id, task.step, "WAITING FOR ME", text.split("\n")[0] ?? "")
    const { bridge } = yield* OrqConfig
    const sent = yield* Effect.tryPromise(() =>
      fetch("http://bridge/ask", { method: "POST", body: JSON.stringify({ id, text }), unix: bridge } as RequestInit),
    ).pipe(
      Effect.flatMap((r) => Effect.promise(() => r.text()).pipe(Effect.map((body) => (r.ok ? "posted in the task's Slack thread" : body)))),
      Effect.orElseSucceed(() => "no Slack bridge; the question is only here"),
    )
    yield* Console.log(`${id}: WAITING FOR ME; ${sent}`)
  }),
).pipe(Command.withDescription("wait for the user: status WAITING FOR ME, the question in the task's Slack thread"), withState)

const send = Command.make("send", { id, text: Argument.String("text") }, ({ id, text }) =>
  Effect.gen(function* () {
    const task = yield* (yield* Db).get(id)
    yield* Console.log(yield* sendToTask(id, task.worktree, yield* baseBranch(task.repo), text))
  }),
).pipe(Command.withDescription("type a message into the task's session (opens it again if it is closed)"), withState)

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
    yield* Console.log(`close the zellij tab orq-${id} if it is still open`)
  }),
).pipe(Command.withDescription("remove a merged or dropped task's worktree and branch; the task stays in orq ls"), withState)

const file = Command.make("file", { id, name: Argument.Literals("name", TEMPLATES) }, ({ id, name }) =>
  Effect.gen(function* () {
    const out = join(yield* topLevel(), ".orqestrai", "tasks", id, `${name}.md`)
    if (!existsSync(dirname(out))) return yield* new OrqError({ message: `no task folder for ${id} here; are you in its worktree?` })
    if (existsSync(out)) return yield* new OrqError({ message: `${out} exists; edit it instead` })
    writeFileSync(out, templates[name].replaceAll("{{id}}", id))
    yield* Console.log(out)
  }),
).pipe(Command.withDescription("new task file from templates/<name>.md"))

const orq = Command.make("orq").pipe(
  Command.withDescription("orqestrai mechanics. The workflow is in the skills."),
  Command.withSubcommands([init, newTask, open, state, show, link, ask, send, ls, file, cleanTask, slot, serve, bridge]),
)

const AppLayer = OrqConfig.layer.pipe(Layer.provideMerge(BunServices.layer))

Command.run(orq, { version: VERSION }).pipe(
  Effect.tapError((e) => (CliError.isCliError(e) ? Effect.void : Console.error(`orq: ${e.message}`))),
  Effect.provide(AppLayer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
