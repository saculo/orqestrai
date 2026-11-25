// Starting a task: the one way, for `orq new` and `orq issues`.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { OrqConfig } from "@orqestrai/core/config.ts"
import { Db } from "@orqestrai/core/db.ts"
import { type Source, slugify } from "@orqestrai/core/domain.ts"
import { Effect } from "effect"
import { syncFilesOrWarn } from "./files.ts"
import { addWorktree, baseBranch, projectSpace, requireRef } from "./git.ts"
import { openSession } from "./herdr.ts"

export interface StartOptions {
  /** the playbook the task runs; without, the session chooses */
  readonly playbook?: string | undefined
  /** where it was started; cli when not given */
  readonly source?: Source
  /** the task's title; the request when not given */
  readonly title?: string
  /** what it was started from, linked as its origin before its session starts */
  readonly origin?: { readonly kind: string; readonly ref: string }
}

/** Task id, row, worktree, branch, REQUEST.md (and its copy on the server) and its session, for the project at `root`.
 * Gives back the task and what happened to the session: its message, and whether the project's space was not open. */
export const startTask = (root: string, request: string, { playbook, source, title = request, origin }: StartOptions = {}) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    const base = yield* baseBranch(root)
    yield* requireRef(root, base)

    const worktrees = join(home, "worktrees", root.split("/").at(-1) ?? "repo")
    const created = yield* db.create({
      repo: root,
      title,
      slug: slugify(title),
      base,
      ...(playbook ? { type: playbook } : {}),
      ...(source ? { source } : {}),
    })

    // The id is held; set up the worktree, and give the id back if that fails.
    const worktree = join(worktrees, created.branch.slice("orq/".length))
    yield* addWorktree(root, created.branch, worktree, base).pipe(Effect.tapError(() => db.remove(created.id)))
    yield* db.start(created.id, root, worktree)
    const task = { ...created, repo: root, worktree }
    const dir = join(worktree, ".orqestrai", "tasks", task.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "REQUEST.md"), `---\nid: ${task.id}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)
    if (origin) yield* db.link(task.id, origin.kind, origin.ref, "origin")
    yield* syncFilesOrWarn(task)
    // A space that is not open is an outcome, not a failure: the task and its worktree stay.
    const session = yield* openSession(task.id, worktree, base, yield* projectSpace(root)).pipe(
      Effect.map((message) => ({ message, spaceNotOpen: false })),
      Effect.catchTag("SpaceNotOpen", (e) => Effect.succeed({ message: e.message, spaceNotOpen: true })),
    )
    return { task, worktree, session }
  })
