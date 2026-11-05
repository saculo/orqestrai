// orq clean: remove a finished task's worktree and local branch. The task row, its links and
// its events stay. A merged task's files are in the base branch already. A dropped task never
// merges, so what its branch holds is copied to $ORQ_HOME/archive/<repo>/<id>/ first: its task
// folder, and the out-of-scope notes triage wrote, so triage can still find them.
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { basename, join } from "node:path"
import { Effect } from "effect"
import { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import { OrqError, type Task } from "./domain.ts"
import { baseBranch } from "./git.ts"
import { prOf, syncMerged, viewPr } from "./pr.ts"
import { exec, run } from "./proc.ts"
import { Slots } from "./slots.ts"

const refuse = (message: string) => Effect.fail(new OrqError({ message: `${message} Nothing was removed.` }))
const OUT_OF_SCOPE = ".orqestrai/out-of-scope/"

/** A merged task: every commit on the branch must be in the PR, or clean would lose it. */
const requireInPr = (task: Task, tip: string) =>
  Effect.gen(function* () {
    const ref = yield* prOf(task.id)
    const pr = ref ? yield* viewPr(task.repo, ref) : null
    if (!pr) return yield* refuse(`cannot read the PR of ${task.id} with gh.`)
    if (tip !== pr.headRefOid)
      return yield* refuse(
        `${task.branch} is at ${tip.slice(0, 7)}, the PR at ${pr.headRefOid.slice(0, 7)}: some commits are not in the PR.`,
      )
  })

/** A dropped task: copy what its branch adds to the archive. Refuses a change it would lose. */
const archive = (task: Task, home: string) =>
  Effect.gen(function* () {
    if (!existsSync(task.worktree))
      return yield* refuse(`${task.branch} is not merged and its worktree ${task.worktree} is gone, so its files cannot be archived.`)
    const base = yield* baseBranch(task.repo)
    const changed = (yield* exec("git", ["diff", "--name-only", `${base}...${task.branch}`], task.repo)).split("\n").filter(Boolean)
    const folder = `.orqestrai/tasks/${task.id}/`
    const other = changed.filter((f) => !f.startsWith(folder) && !f.startsWith(OUT_OF_SCOPE))
    if (other.length) return yield* refuse(`${task.branch} changes files outside its task folder and ${OUT_OF_SCOPE}: ${other.join(", ")}.`)
    const out = join(home, "archive", basename(task.repo), task.id)
    mkdirSync(out, { recursive: true })
    const files = join(task.worktree, folder)
    if (existsSync(files)) cpSync(files, out, { recursive: true })
    for (const f of changed.filter((f) => f.startsWith(OUT_OF_SCOPE) && existsSync(join(task.worktree, f))))
      cpSync(join(task.worktree, f), join(out, "out-of-scope", f.slice(OUT_OF_SCOPE.length)), { recursive: true })
    return out
  })

/** Returns what it removed or kept, one line each. */
export const clean = (id: string) =>
  Effect.gen(function* () {
    const { home } = yield* OrqConfig
    const db = yield* Db
    yield* syncMerged([yield* db.get(id)])
    const task = yield* db.get(id)
    if (task.status !== "MERGED" && task.status !== "DROPPED")
      return yield* refuse(`${id} is ${task.status}. orq clean removes only a merged or dropped task.`)

    const tip = yield* run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${task.branch}`], task.repo)
    const hasWorktree = existsSync(task.worktree)
    if (hasWorktree && (yield* exec("git", ["status", "--porcelain"], task.worktree)))
      return yield* refuse(`${task.worktree} has uncommitted changes. Commit or remove them first.`)

    const done: string[] = []
    if (tip.code === 0) {
      if (task.status === "MERGED") yield* requireInPr(task, tip.stdout.trim())
      else done.push(`archived ${yield* archive(task, home)}`)
    }
    const slot = yield* (yield* Slots).free(id)
    if (slot) done.push(`freed verify slot ${slot.n}`)
    if (hasWorktree) {
      yield* exec("git", ["worktree", "remove", task.worktree], task.repo)
      done.push(`removed worktree ${task.worktree}`)
    }
    if (tip.code === 0) {
      yield* exec("git", ["branch", "-D", task.branch], task.repo)
      done.push(`removed branch ${task.branch}`)
    }
    yield* db.setState(id, task.step, task.status, `cleaned: ${done.join("; ") || "nothing left to remove"}`)
    return done
  })
