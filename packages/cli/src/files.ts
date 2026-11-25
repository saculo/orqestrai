// A copy of the task's files on the server, for the dashboard: whenever a step reports (orq new,
// state, ask), the CLI sends what changed in the task's folder of its worktree. The server may be
// on another machine than the worktree; the copy is how the dashboard sees the files anyway.
import { createHash } from "node:crypto"
import { closeSync, constants, existsSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Db } from "@orqestrai/core/db.ts"
import { isTaskFilePath, MAX_FILE_BYTES, MAX_IMAGES, OrqError, TASK_FILES, type Task } from "@orqestrai/core/domain.ts"
import { Cause, Effect } from "effect"

/** One request carries at most this much (before base64); more goes in the next one. */
const BATCH_BYTES = 16 * 1024 * 1024

export const taskDir = (task: Task & { readonly worktree: string }) => join(task.worktree, ".orqestrai", "tasks", task.id)

/** A regular file, not a symbolic link: a link could point anywhere on the machine. */
const isPlainFile = (path: string) => {
  const st = lstatSync(path, { throwIfNoEntry: false })
  return st?.isFile() === true && st.size <= MAX_FILE_BYTES
}

/** The files the server keeps a copy of, as paths relative to `dir`: the task files, then the
 * evidence images (sorted, at most MAX_IMAGES, none over MAX_FILE_BYTES). Symbolic links, to
 * files or folders, are left out. */
export const taskFiles = (dir: string): string[] => {
  const files = TASK_FILES.map((name) => `${name}.md`).filter((f) => isPlainFile(join(dir, f)))
  const images: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (images.length >= MAX_IMAGES) return
      const path = join(d, name)
      const st = lstatSync(path)
      const rel = relative(dir, path).split(sep).join("/")
      if (st.isDirectory()) walk(path)
      else if (isTaskFilePath(rel) && isPlainFile(path)) images.push(rel)
    }
  }
  if (lstatSync(join(dir, "evidence"), { throwIfNoEntry: false })?.isDirectory()) walk(join(dir, "evidence"))
  return [...files, ...images]
}

/** Reads a file, refusing a symbolic link even if one replaced the file since taskFiles. */
const readPlain = (path: string) => {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    return new Uint8Array(readFileSync(fd))
  } finally {
    closeSync(fd)
  }
}

/** The task's folder, as it is now; nothing when the worktree is not on this machine. The folder
 * itself must be inside the worktree (not a link to elsewhere). */
const readTaskFolder = (task: Task) =>
  Effect.try({
    try: () => {
      if (task.worktree === null) return null
      const dir = taskDir({ ...task, worktree: task.worktree })
      if (!existsSync(dir)) return null
      if (!realpathSync(dir).startsWith(realpathSync(task.worktree) + sep)) throw new Error(`${dir} is a link out of the worktree`)
      return taskFiles(dir).map((path) => ({ path, content: readPlain(join(dir, path)) }))
    },
    catch: (e) => new OrqError({ message: `cannot read the task files: ${e instanceof Error ? e.message : String(e)}` }),
  })

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex")

/** Sends the task's files that the server does not have as they are, and lets it forget the
 * ones that are gone. Nothing to do when the worktree is not on this machine. */
export const syncFiles = (task: Task): Effect.Effect<number, OrqError, Db> =>
  Effect.gen(function* () {
    const local = yield* readTaskFolder(task)
    if (local === null) return 0
    const db = yield* Db
    const have = new Map((yield* db.fileSums(task.id)).map((f) => [f.path, f.sha256]))
    const paths = local.map((f) => f.path)
    const changed = local.filter((f) => have.get(f.path) !== sha256(f.content))
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

/** syncFiles after a step reported: any failure, even an unexpected one, is a warning; the
 * report itself stands. */
export const syncFilesOrWarn = (task: Task) =>
  syncFiles(task).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const e = Cause.squash(cause)
        console.error(`orq: warning: the task files did not reach the dashboard: ${e instanceof Error ? e.message : String(e)}`)
      }),
    ),
  )
