// The dashboard: one read-only React page (src/dashboard/, which Bun bundles and serves at /) and
// the reads it needs, served by `orq serve` next to the API. Everything comes from the database:
// a task's files and evidence too, from the copy the CLI sends (src/files.ts), so the page is the
// same whether the worktrees are on this machine or another.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import page from "./dashboard/index.html"
import { Db } from "./db.ts"
import { IMAGE_TYPES, isTaskFilePath, OrqError, TASK_FILES } from "./domain.ts"

/** The page: Bun bundles its TSX and CSS and serves it (Bun.serve `routes`, src/server.ts). */
export const PAGE = { "/": page }

/** Bun names the page's bundled files by their path from the working directory, and serves
 * them only when that directory holds the page; so `orq serve` works from the page's folder.
 * In the compiled binary the page is inside the binary, and there is no such folder. */
export const enterPageDir = () => {
  const dir = join(import.meta.dir, "dashboard")
  if (existsSync(join(dir, "index.html"))) process.chdir(dir)
}

const json = (body: unknown) => HttpServerResponse.text(JSON.stringify(body), { contentType: "application/json" })
const notFound = (e: OrqError) => Effect.succeed(HttpServerResponse.text(e.message, { status: 404 }))

/** The `status:` line of a file's frontmatter, if it has one. */
const frontmatterStatus = (text: string) => /^---\n[\s\S]*?^status:\s*(\S+)[\s\S]*?^---$/m.exec(text)?.[1] ?? null

const utf8 = new TextDecoder()

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
          const paths = (yield* db.fileSums(task.id)).map((f) => f.path)
          const files = yield* Effect.forEach(
            TASK_FILES.filter((name) => paths.includes(`${name}.md`)),
            (name) => db.file(task.id, `${name}.md`).pipe(Effect.map((c) => ({ name, status: frontmatterStatus(utf8.decode(c)) }))),
          )
          return json({ files, evidence: paths.filter((p) => p.startsWith("evidence/")).map((p) => p.slice("evidence/".length)) })
        }).pipe(Effect.catch(notFound)),
      ),
      HttpRouter.add(
        "GET",
        "/tasks/:id/files/:name",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params
          const name = params.name ?? ""
          if (!(TASK_FILES as ReadonlyArray<string>).includes(name)) return yield* new OrqError({ message: `no ${name}.md` })
          const content = yield* db.file(params.id ?? "", `${name}.md`)
          return HttpServerResponse.text(utf8.decode(content), { contentType: "text/markdown; charset=utf-8" })
        }).pipe(Effect.catch(notFound)),
      ),
      HttpRouter.add(
        "GET",
        "/tasks/:id/evidence/*",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params
          const path = `evidence/${params["*"] ?? ""}`
          const type = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""]
          // only evidence images: the database holds nothing else, and the path is checked anyway
          if (!type || !isTaskFilePath(path)) return yield* new OrqError({ message: "no such image" })
          return HttpServerResponse.uint8Array(yield* db.file(params.id ?? "", path), { contentType: type })
        }).pipe(Effect.catch(notFound)),
      ),
    )
  }),
)
