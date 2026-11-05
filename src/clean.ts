// orq clean: remove a finished task's worktree and local branch. The task row, its links and
// its events stay. A merged task's files are in the base branch already; a dropped task's files
// are copied to $ORQ_HOME/archive/<repo>/<id>/ first, so triage can still find them.
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { basename, join } from "node:path"
import { Effect } from "effect"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { OrqError, type Task } from "./domain.ts"
import { prOf, syncMerged, viewPr } from "./pr.ts"
import { exec, run } from "./proc.ts"

const refuse = (message: string) => Effect.fail(new OrqError({ message: `${message} Nothing was removed.` }))

/** A merged task: every local commit must be in the PR, or clean would lose it. */
const requireInPr = (task: Task) =>
  Effect.gen(function* () {
    const ref = yield* prOf(task.id)
    const pr = ref ? yield* viewPr(task.repo, ref) : null
    if (!pr) return yield* refuse(`cannot read the PR of ${task.id} with gh.`)
    const head = yield* exec("git", ["rev-parse", "HEAD"], task.worktree)
    if (head !== pr.headRefOid)
      return yield* refuse(
        `${task.branch} is at ${head.slice(0, 7)}, the PR at ${pr.headRefOid.slice(0, 7)}: some commits are not in the PR.`,
      )
  })

const archive = (task: Task, home: string) => {
  const files = join(task.worktree, ".orqestrai", "tasks", task.id)
  if (!existsSync(files)) return undefined
  const out = join(home, "archive", basename(task.repo), task.id)
  mkdirSync(out, { recursive: true })
  cpSync(files, out, { recursive: true })
  return out
}

/** Returns what it removed or kept, one line each. */
export const clean = (id: string) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    yield* syncMerged([yield* db.get(id)])
    const task = yield* db.get(id)
    if (task.status !== "MERGED" && task.status !== "DROPPED")
      return yield* refuse(`${id} is ${task.status}. orq clean removes only a merged or dropped task.`)

    const done: string[] = []
    if (existsSync(task.worktree)) {
      if (yield* exec("git", ["status", "--porcelain"], task.worktree))
        return yield* refuse(`${task.worktree} has uncommitted changes. Commit or remove them first.`)
      if (task.status === "MERGED") yield* requireInPr(task)
      else {
        const out = archive(task, home)
        if (out) done.push(`archived ${out}`)
      }
      yield* exec("git", ["worktree", "remove", task.worktree], task.repo)
      done.push(`removed worktree ${task.worktree}`)
    }
    if ((yield* run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${task.branch}`], task.repo)).code === 0) {
      yield* exec("git", ["branch", "-D", task.branch], task.repo)
      done.push(`removed branch ${task.branch}`)
    }
    yield* db.setState(id, task.step, task.status, `cleaned: ${done.join("; ") || "nothing left to remove"}`)
    return done
  })
