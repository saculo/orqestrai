// orq: the mechanics of orqestrai. Task ids, state, worktrees, zellij tabs, task files.
// The workflow lives in skills/. This program does not decide. It only does.
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Layer } from "effect"
import { Argument, CliError, Command } from "effect/cli"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { LINK_ROLES, OrqError, STATUSES, STEPS, TEMPLATES, slugify } from "./domain.ts"
import { addWorktree, baseBranch, requireRef, topLevel } from "./git.ts"
import { install } from "./init.ts"
import { openTab } from "./zellij.ts"

/** The guard hook and the skills call `orq` by name. Without it on PATH the guards are off. */
const warnIfNotOnPath = Effect.gen(function* () {
  if (Bun.which("orq")) return
  const { root } = yield* OrqConfig
  yield* Console.error(`orq: warning: orq is not on PATH, so the guard hook and the skills cannot call it.\n  ln -s "${root}/bin/orq" ~/.local/bin/orq`)
})

const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const { root: orqRoot } = yield* OrqConfig
    const project = yield* topLevel()
    const { skills, agents } = yield* install(orqRoot, project, yield* baseBranch(project))
    yield* Console.log(`.orqestrai/config.toml\n.claude/skills: ${skills.join(" ")}\n.claude/agents: ${agents.join(" ")}`)
    yield* Console.log(".claude/settings.json: PreToolUse hook `orq guard`")
    yield* warnIfNotOnPath
  }),
).pipe(Command.withDescription("install orqestrai into this project: .orqestrai/ and .claude/"))

const id = Argument.String("id").pipe(Argument.withDescription("task id, e.g. T-0001"))

const newTask = Command.make("new", { request: Argument.String("request") }, ({ request }) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    const root = yield* topLevel()
    const base = yield* baseBranch(root)
    yield* requireRef(root, base)

    const tid = yield* db.nextId
    const slug = slugify(request)
    const branch = `orq/${tid}-${slug}`
    const worktree = join(home, "worktrees", root.split("/").at(-1) ?? "repo", `${tid}-${slug}`)

    yield* addWorktree(root, branch, worktree, base)
    const dir = join(worktree, ".orqestrai", "tasks", tid)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "REQUEST.md"), `---\nid: ${tid}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)

    yield* db.insert({ id: tid, repo: root, title: request, branch, worktree, note: `${branch} from ${base}` })
    yield* Console.log(`${tid}  ${branch}  ${worktree}`)
    yield* Console.log(yield* openTab(tid, worktree, base))
    yield* warnIfNotOnPath
  }),
).pipe(Command.withDescription("new task: id, branch, worktree, zellij tab"))

const open = Command.make("open", { id }, ({ id }) =>
  Effect.gen(function* () {
    const task = yield* (yield* Db).get(id)
    if (!existsSync(task.worktree)) return yield* new OrqError({ message: `worktree ${task.worktree} is gone` })
    yield* Console.log(yield* openTab(id, task.worktree, yield* baseBranch(task.repo)))
  }),
).pipe(Command.withDescription("open the task's tab again (after a restart)"))

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
).pipe(Command.withDescription("record step and status"))

const show = Command.make("show", { id }, ({ id }) =>
  Effect.gen(function* () {
    const db = yield* Db
    const task = yield* db.get(id)
    const width = Math.max(...Object.keys(task).map((k) => k.length))
    for (const [k, v] of Object.entries(task)) yield* Console.log(`${k.padStart(width)} = ${v ?? ""}`)
    for (const l of yield* db.links(id)) yield* Console.log(`link ${l.kind} ${l.ref} (${l.role})`)
    yield* Console.log("")
    for (const e of yield* db.events(id, 10)) yield* Console.log(`${e.at}  ${e.kind.padEnd(22)}  ${e.detail ?? ""}`)
  }),
).pipe(Command.withDescription("one task and its last events"))

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
).pipe(Command.withDescription("link the task to an outside reference (origin | related)"))

const ls = Command.make("ls", {}, () =>
  Effect.gen(function* () {
    for (const t of yield* (yield* Db).list)
      yield* Console.log(`${t.id}  ${t.step.padEnd(6)}  ${t.status.padEnd(14)}  ${t.title.slice(0, 50).padEnd(50)}  ${t.updated_at}`)
  }),
).pipe(Command.withDescription("all tasks"))

const file = Command.make("file", { id, name: Argument.Literals("name", TEMPLATES) }, ({ id, name }) =>
  Effect.gen(function* () {
    const { root: orqRoot } = yield* OrqConfig
    const out = join(yield* topLevel(), ".orqestrai", "tasks", id, `${name}.md`)
    if (!existsSync(dirname(out))) return yield* new OrqError({ message: `no task folder for ${id} here; are you in its worktree?` })
    if (existsSync(out)) return yield* new OrqError({ message: `${out} exists; edit it instead` })
    writeFileSync(out, readFileSync(join(orqRoot, "templates", `${name}.md`), "utf8").replaceAll("{{id}}", id))
    yield* Console.log(out)
  }),
).pipe(Command.withDescription("new task file from templates/<name>.md"))

const orq = Command.make("orq").pipe(
  Command.withDescription("orqestrai mechanics. The workflow is in the skills."),
  Command.withSubcommands([init, newTask, open, state, show, link, ls, file]),
)

const AppLayer = Db.layer.pipe(Layer.provideMerge(OrqConfig.layer), Layer.provideMerge(BunServices.layer))

Command.run(orq, { version: "0.1.0" }).pipe(
  Effect.tapError((e) =>
    e instanceof OrqError ? Console.error(`orq: ${e.message}`) : CliError.isCliError(e) ? Effect.void : Console.error(`orq: ${String(e)}`),
  ),
  Effect.provide(AppLayer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
