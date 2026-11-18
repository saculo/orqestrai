// The dashboard: one read-only React page (src/dashboard/, which Bun bundles and serves at /) and
// the reads it needs, served by `orq serve` next to the API. A task's files and evidence are read from its worktree when the
// worktree is on this machine; elsewhere the page shows the database's view only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, resolve, sep } from "node:path"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import page from "./dashboard/index.html"
import { Db } from "./db.ts"
import { OrqError, type Task, TEMPLATES } from "./domain.ts"

/** The task files the page shows, in the order of the steps. */
export const FILES = ["REQUEST", ...TEMPLATES] as const

/** The page: Bun bundles its TSX and CSS and serves it (Bun.serve `routes`, src/server.ts). */
export const PAGE = { "/": page }

/** Bun names the page's bundled files by their path from the working directory, and serves
 * them only when that directory holds the page; so `orq serve` works from the page's folder.
 * In the compiled binary the page is inside the binary, and there is no such folder. */
export const enterPageDir = () => {
  const dir = join(import.meta.dir, "dashboard")
  if (existsSync(join(dir, "index.html"))) process.chdir(dir)
}

const IMAGES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const json = (body: unknown) => HttpServerResponse.text(JSON.stringify(body), { contentType: "application/json" })
const notFound = (e: OrqError) => Effect.succeed(HttpServerResponse.text(e.message, { status: 404 }))

const taskDir = (task: Task) => join(task.worktree, ".orqestrai", "tasks", task.id)

/** The `status:` line of a file's frontmatter, if it has one. */
const frontmatterStatus = (text: string) => /^---\n[\s\S]*?^status:\s*(\S+)[\s\S]*?^---$/m.exec(text)?.[1] ?? null

/** Image files under `dir`, as paths relative to it, newest folders last. */
const images = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (IMAGES[extname(name).toLowerCase()]) found.push(relative(dir, path))
      if (found.length >= 60) return
    }
  }
  walk(dir)
  return found
}

/** What the page needs, from the database, in one call: every task with its last state note,
 * the message it waits on (when it waits) and its links. */
const board = (db: Db["Service"]) =>
  db.list.pipe(
    Effect.flatMap((tasks) =>
      Effect.forEach(tasks, (task) =>
        Effect.gen(function* () {
          const events = yield* db.events(task.id, 30)
          const iState = events.findIndex((e) => e.kind.includes(": "))
          const iMessage = events.findIndex((e) => e.kind === "message")
          const waits = task.status === "WAITING FOR ME" || task.status === "BLOCKED"
          return {
            ...task,
            note: iState >= 0 ? (events[iState]?.detail ?? "") : "",
            message: waits && iMessage >= 0 && (iState < 0 || iMessage < iState) ? (events[iMessage]?.detail ?? null) : null,
            links: yield* db.links(task.id),
          }
        }),
      ),
    ),
  )

export const dashboard = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* Db
    const id = HttpRouter.params.pipe(Effect.map((p) => p.id ?? ""))

    return Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/board",
        board(db).pipe(
          Effect.map(json),
          Effect.catch((e) => Effect.succeed(HttpServerResponse.text(e.message, { status: 500 }))),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/tasks/:id/files",
        Effect.gen(function* () {
          const task = yield* db.get(yield* id)
          const dir = taskDir(task)
          if (!existsSync(dir)) return json({ here: false, files: [], evidence: [] })
          const files = FILES.filter((f) => existsSync(join(dir, `${f}.md`))).map((name) => ({
            name,
            status: frontmatterStatus(readFileSync(join(dir, `${name}.md`), "utf8")),
          }))
          return json({ here: true, files, evidence: images(join(dir, "evidence")) })
        }).pipe(Effect.catch(notFound)),
      ),
      HttpRouter.add(
        "GET",
        "/tasks/:id/files/:name",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params
          const name = params.name ?? ""
          const task = yield* db.get(params.id ?? "")
          const path = join(taskDir(task), `${name}.md`)
          if (!(FILES as ReadonlyArray<string>).includes(name) || !existsSync(path))
            return yield* new OrqError({ message: `no ${name}.md in ${task.id}` })
          return HttpServerResponse.text(readFileSync(path, "utf8"), { contentType: "text/markdown; charset=utf-8" })
        }).pipe(Effect.catch(notFound)),
      ),
      HttpRouter.add(
        "GET",
        "/tasks/:id/evidence/*",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params
          const task = yield* db.get(params.id ?? "")
          const dir = resolve(taskDir(task), "evidence")
          const path = resolve(dir, params["*"] ?? "")
          const type = IMAGES[extname(path).toLowerCase()]
          // only images, and only inside the task's evidence folder
          if (!type || !path.startsWith(dir + sep) || !existsSync(path)) return yield* new OrqError({ message: "no such image" })
          return HttpServerResponse.uint8Array(readFileSync(path), { contentType: type })
        }).pipe(Effect.catch(notFound)),
      ),
    )
  }),
)
