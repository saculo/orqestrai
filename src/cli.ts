// orq: the mechanics of orqestrai. Task ids, state, worktrees, zellij tabs, task files, PR state.
// The workflow lives in skills/. This program does not decide. It only does.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
import { Argument, CliError, Command } from "effect/cli"
import { clean } from "./clean.ts"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { LINK_ROLES, OrqError, STATUSES, STEPS, slugify, stamp, TEMPLATES } from "./domain.ts"
import { addWorktree, baseBranch, requireRef, topLevel } from "./git.ts"
import { install } from "./init.ts"
import { syncMerged } from "./pr.ts"
import { serve } from "./server.ts"
import { slot } from "./slot-cli.ts"
import { withState } from "./state.ts"
import { templates } from "./templates.ts"
import { VERSION } from "./version.ts"
import { openTab } from "./zellij.ts"

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
    const { home } = yield* OrqConfig
    const db = yield* Db
    const root = yield* topLevel()
    const base = yield* baseBranch(root)
    yield* requireRef(root, base)

    const worktrees = join(home, "worktrees", root.split("/").at(-1) ?? "repo")
    const { id: tid, branch, worktree } = yield* db.create({ repo: root, title: request, slug: slugify(request), worktrees, base })

    // The id is held; set up the worktree, and give the id back if that fails.
    yield* addWorktree(root, branch, worktree, base).pipe(Effect.tapError(() => db.remove(tid)))
    const dir = join(worktree, ".orqestrai", "tasks", tid)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "REQUEST.md"), `---\nid: ${tid}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)
    yield* Console.log(`${tid}  ${branch}  ${worktree}`)
    yield* Console.log(yield* openTab(tid, worktree, base))
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
  Command.withSubcommands([init, newTask, open, state, show, link, ls, file, cleanTask, slot, serve]),
)

const AppLayer = OrqConfig.layer.pipe(Layer.provideMerge(BunServices.layer))

Command.run(orq, { version: VERSION }).pipe(
  Effect.tapError((e) => (CliError.isCliError(e) ? Effect.void : Console.error(`orq: ${e.message}`))),
  Effect.provide(AppLayer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
