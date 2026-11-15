// Starting a task: the one way, for `orq new` and for the Slack bridge.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { slugify } from "./domain.ts"
import { addWorktree, baseBranch, requireRef } from "./git.ts"
import { openTab } from "./zellij.ts"

/** Task id, row, worktree, branch, REQUEST.md and its zellij tab, for the project at `root`.
 * Gives back the task and what happened to the tab. */
export const startTask = (root: string, request: string) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    const base = yield* baseBranch(root)
    yield* requireRef(root, base)

    const worktrees = join(home, "worktrees", root.split("/").at(-1) ?? "repo")
    const task = yield* db.create({ repo: root, title: request, slug: slugify(request), worktrees, base })

    // The id is held; set up the worktree, and give the id back if that fails.
    yield* addWorktree(root, task.branch, task.worktree, base).pipe(Effect.tapError(() => db.remove(task.id)))
    const dir = join(task.worktree, ".orqestrai", "tasks", task.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "REQUEST.md"), `---\nid: ${task.id}\ncreated: ${new Date().toISOString()}\n---\n\n${request}\n`)
    return { task, tab: yield* openTab(task.id, task.worktree, base) }
  })
