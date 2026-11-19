// A copy of the task's files on the server, for the dashboard: whenever a step reports (orq new,
// state, ask), the CLI sends what changed in the task's folder of its worktree. The server may be
// on another machine than the worktree; the copy is how the dashboard sees the files anyway.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Effect } from "effect"
import { Db } from "./db.ts"
import { isTaskFilePath, MAX_FILE_BYTES, MAX_IMAGES, type OrqError, TASK_FILES, type Task } from "./domain.ts"

/** One request carries at most this much (before base64); more goes in the next one. */
const BATCH_BYTES = 16 * 1024 * 1024

export const taskDir = (task: Task) => join(task.worktree, ".orqestrai", "tasks", task.id)

/** The files the server keeps a copy of, as paths relative to `dir`: the task files, then the
 * evidence images (sorted, at most MAX_IMAGES, none over MAX_FILE_BYTES). */
export const taskFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const files = TASK_FILES.map((name) => `${name}.md`).filter((f) => existsSync(join(dir, f)))
  const images: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (images.length >= MAX_IMAGES) return
      const path = join(d, name)
      const st = statSync(path)
      const rel = relative(dir, path).split(sep).join("/")
      if (st.isDirectory()) walk(path)
      else if (isTaskFilePath(rel) && st.size <= MAX_FILE_BYTES) images.push(rel)
    }
  }
  if (existsSync(join(dir, "evidence"))) walk(join(dir, "evidence"))
  return [...files, ...images]
}

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex")

/** Sends the task's files that the server does not have as they are, and lets it forget the
 * ones that are gone. Nothing to do when the worktree is not on this machine. */
export const syncFiles = (task: Task): Effect.Effect<number, OrqError, Db> =>
  Effect.gen(function* () {
    const dir = taskDir(task)
    if (!existsSync(dir)) return 0
    const db = yield* Db
    const have = new Map((yield* db.fileSums(task.id)).map((f) => [f.path, f.sha256]))
    const paths = taskFiles(dir)
    const changed = paths
      .map((path) => ({ path, content: new Uint8Array(readFileSync(join(dir, path))) }))
      .filter((f) => have.get(f.path) !== sha256(f.content))
    const gone = [...have.keys()].some((p) => !paths.includes(p))
    if (changed.length === 0 && !gone) return 0

    // every batch keeps all the current paths, so a later batch's files are not forgotten meanwhile
    const batches: Array<typeof changed> = [[]]
    let size = 0
    for (const f of changed) {
      const last = batches[batches.length - 1] ?? []
      if (size + f.content.byteLength > BATCH_BYTES && last.length > 0) {
        batches.push([f])
        size = f.content.byteLength
      } else {
        last.push(f)
        size += f.content.byteLength
      }
    }
    for (const batch of batches) yield* db.putFiles(task.id, batch, paths)
    return changed.length
  })

/** syncFiles after a step reported: a failure is a warning, the report itself stands. */
export const syncFilesOrWarn = (task: Task) =>
  syncFiles(task).pipe(
    Effect.asVoid,
    Effect.catch((e) => Effect.sync(() => console.error(`orq: warning: the task files did not reach the dashboard: ${e.message}`))),
  )
