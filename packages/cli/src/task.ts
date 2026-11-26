// Adding a task (`orq new`) and starting it (`orq start`): a task is added to
// the backlog first; starting gives it its worktree, REQUEST.md and session.
import { mkdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { OrqConfig } from "@orqestrai/core/config.ts"
import { Db } from "@orqestrai/core/db.ts"
import { headline, OrqError, type Source, slugify, type Task } from "@orqestrai/core/domain.ts"
import { run } from "@orqestrai/core/proc.ts"
import { Config, Effect } from "effect"
import { syncFilesOrWarn } from "./files.ts"
import { addWorktree, baseBranch, fetchBase, projectSpace, requireRef } from "./git.ts"
import { openSession } from "./herdr.ts"

export interface AddOptions {
  /** the playbook the task runs; without, the session chooses */
  readonly playbook?: string | undefined
  /** where it came from; cli when not given */
  readonly source?: Source
  /** the task's title; the request when not given */
  readonly title?: string
  /** what it was added from, linked as its origin */
  readonly origin?: { readonly kind: string; readonly ref: string }
}

/** `owner/name=/path,…` as pairs. */
export const parseRepos = (spec: string) =>
  spec
    .split(",")
    .map((pair) => pair.trim().split("=", 2) as [string, string])
    .filter(([repo, checkout]) => repo && checkout)

/** Task id, row, the request as its stored REQUEST.md and its origin link, for the project at `root`.
 * No branch, worktree or session yet: that is `startTask`. */
export const addTask = (root: string, request: string, { playbook, source, title = request, origin }: AddOptions = {}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const base = yield* baseBranch(root)
    yield* requireRef(root, base)
    const task = yield* db.create({
      repo: root,
      title,
      slug: slugify(title),
      base,
      ...(playbook ? { type: playbook } : {}),
      ...(source ? { source } : {}),
    })
    const content = new TextEncoder().encode(`---\nid: ${task.id}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)
    yield* db.putFiles(task.id, [{ path: "REQUEST.md", content }], [])
    if (origin) yield* db.link(task.id, origin.kind, origin.ref, "origin")
    return task
  })

/** The task's checkout: its `repo` when that is a path, else the checkout of the GitHub repo in `[github] repos`. */
const checkoutOf = (task: Task) =>
  Effect.gen(function* () {
    if (task.repo.startsWith("/")) return task.repo
    const spec = yield* Config.String("ORQ_GITHUB_REPOS").pipe(Config.withDefault(""))
    const found = parseRepos(spec).find(([repo]) => repo === task.repo)
    if (!found) return yield* new OrqError({ message: `no checkout for ${task.repo}: add it to [github] repos in the settings file` })
    return found[1]
  })

/** Branch and worktree from the latest base: `origin/<base>` after a fetch, the local base when the checkout has no origin. */
const makeWorktree = (checkout: string, branch: string, worktree: string, base: string) =>
  Effect.gen(function* () {
    const hasOrigin = (yield* run("git", ["remote", "get-url", "origin"], checkout)).code === 0
    if (hasOrigin) yield* fetchBase(checkout, base)
    const from = hasOrigin ? `origin/${base}` : base
    yield* requireRef(checkout, from)
    yield* addWorktree(checkout, branch, worktree, from)
  })

/** Starts a backlog task: fetch, branch, worktree, REQUEST.md, session. Fails when it is started already.
 * Any failure leaves the task BLOCKED with the reason as its note (and not started, so `orq start` runs again),
 * except a space that is not open: then the worktree stays, the note names the space and `orq resume`.
 * Gives back the task and what happened to the session: its message, and whether the space was not open. */
export const startTask = (id: string) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    const task = yield* db.get(id)
    if (task.worktree !== null) return yield* new OrqError({ message: `${id} is already started; orq resume ${id}` })
    const block = (message: string) => db.setState(id, task.step, "BLOCKED", headline(message), message)

    // Claim first: the loser of two starts fails here, "already started", and leaves the task's state alone.
    const checkout = yield* checkoutOf(task).pipe(Effect.tapError((e) => block(e.message).pipe(Effect.ignore)))
    const base = yield* baseBranch(checkout).pipe(Effect.tapError((e) => block(e.message).pipe(Effect.ignore)))
    const worktree = join(home, "worktrees", basename(checkout), task.branch.slice("orq/".length))
    yield* db.start(id, checkout, worktree)
    const started = { ...task, repo: checkout, worktree }
    // A failure after the claim undoes it and blocks the task, so `orq start` runs again after the fix.
    yield* Effect.gen(function* () {
      yield* makeWorktree(checkout, task.branch, worktree, base)
      const dir = join(worktree, ".orqestrai", "tasks", id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "REQUEST.md"), yield* db.file(id, "REQUEST.md"))
    }).pipe(Effect.tapError((e) => db.unstart(id, worktree).pipe(Effect.andThen(block(e.message)), Effect.ignore)))
    yield* syncFilesOrWarn(started)
    // A space that is not open is an outcome: the task and its worktree stay, BLOCKED until resumed.
    const session = yield* openSession(id, worktree, base, yield* projectSpace(checkout)).pipe(
      Effect.map((message) => ({ message, spaceNotOpen: false })),
      Effect.catchTag("SpaceNotOpen", (e) => Effect.succeed({ message: e.message, spaceNotOpen: true })),
    )
    if (session.spaceNotOpen) yield* block(session.message)
    else if (task.status === "BLOCKED") yield* db.setState(id, task.step, "TODO", "")
    return { task: started, worktree, session }
  })
