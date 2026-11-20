// The words of orqestrai: steps, statuses, tasks, links, events, and the one error the CLI reports.
// Every other module imports these; nothing defines them twice. The schemas check rows read
// from the database, where times are ISO 8601 text.
import { Schema } from "effect"

export const STEPS = ["triage", "plan", "impl", "verify", "learn", "ship"] as const
export const Step = Schema.Literals(STEPS)
export type Step = typeof Step.Type

export const STATUSES = ["TODO", "IN PROGRESS", "WAITING FOR ME", "BLOCKED", "DROPPED", "MERGED"] as const
export const Status = Schema.Literals(STATUSES)
export type Status = typeof Status.Type

/** A task's type: the name of the playbook (the workflow) it runs. The skills define them (playbook-<name>);
 * orq only records the name. */
export const TaskType = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)))

export const TEMPLATES = ["BRIEF", "RESEARCH", "SPEC", "VERIFY", "LEARN", "PR"] as const

/** Where a task was started: `orq new` in a terminal, a Slack mention, a GitHub issue (`orq issues`). */
export const SOURCES = ["cli", "slack", "github"] as const
export const Source = Schema.Literals(SOURCES)
export type Source = typeof Source.Type

export const Task = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  title: Schema.String,
  branch: Schema.String,
  worktree: Schema.String,
  step: Step,
  status: Status,
  type: Schema.NullOr(Schema.String),
  source: Source,
  created_at: Schema.DateFromString,
  updated_at: Schema.DateFromString,
})
export type Task = typeof Task.Type

/** What a new task needs; the database gives the id, and the id names the branch and the worktree. */
export const NewTask = Schema.Struct({
  repo: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  /** the folder the task's worktree goes in */
  worktrees: Schema.String,
  base: Schema.String,
  /** set when the user chose it; else the task session chooses */
  type: Schema.optional(TaskType),
  /** cli when not given */
  source: Schema.optional(Source),
})
export type NewTask = typeof NewTask.Type

/** Where a task came from (origin) or what it relates to: an issue, a ticket, a thread, a PR.
 * The kind is open; the adapter that owns a kind is the only code that reads its ref. */
export const LINK_ROLES = ["origin", "related"] as const
export const LinkRole = Schema.Literals(LINK_ROLES)
export type LinkRole = typeof LinkRole.Type

export const TaskLink = Schema.Struct({ kind: Schema.String, ref: Schema.String, role: LinkRole })
export type TaskLink = typeof TaskLink.Type

export const TaskEvent = Schema.Struct({ at: Schema.DateFromString, kind: Schema.String, detail: Schema.NullOr(Schema.String) })
export type TaskEvent = typeof TaskEvent.Type

/** A failure the user can act on. The CLI prints its message and exits 1. */
export class OrqError extends Schema.TaggedError<OrqError>()("OrqError", { message: Schema.String }, { httpApiStatus: 422 }) {}

export const taskId = (n: number): string => `T-${String(n).padStart(4, "0")}`

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "") || "task"

/** A time as orq prints it: UTC, to the second. */
export const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ")

/** A message's headline, as plain text: its first line that is not empty, without Markdown's
 * heading marks and emphasis. It is the task's status note and Slack's notification text. */
export const headline = (message: string) =>
  (message.split("\n").find((l) => l.trim() !== "") ?? "")
    .replace(/^\s*#+\s*/, "")
    .replace(/\*\*|__/g, "")
    .trim()

/** The task files the dashboard shows, in the order of the steps: `<name>.md` in the task's folder. */
export const TASK_FILES = ["REQUEST", ...TEMPLATES] as const

/** The evidence the dashboard shows: images under the task's `evidence/` folder. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

/** The MIME type of an evidence image's path, or null when it is not one. */
export const imageType = (path: string): string | null => {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return Object.hasOwn(IMAGE_TYPES, ext) ? (IMAGE_TYPES[ext] ?? null) : null
}

/** The most the server keeps of one task: so many images, each at most so big. */
export const MAX_IMAGES = 60
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** A path the server keeps a copy of, relative to the task's folder: `SPEC.md`, or an image
 * under `evidence/` (`evidence/V1/V1-list.png`), with no `..`, `.` or empty parts. */
export const isTaskFilePath = (path: string) => {
  if ((TASK_FILES as ReadonlyArray<string>).some((name) => path === `${name}.md`)) return true
  const parts = path.split("/")
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return (
    parts.length >= 2 &&
    parts[0] === "evidence" &&
    parts.every((p) => p !== "" && p !== "." && p !== "..") &&
    !path.includes("\\") &&
    Object.hasOwn(IMAGE_TYPES, ext)
  )
}

/** A file's path and the SHA-256 of its content, hex: what the server has. */
export const FileSum = Schema.Struct({ path: Schema.String, sha256: Schema.String })
export type FileSum = typeof FileSum.Type

/** What a task's last report said: its state note, and the whole message when that report was
 * an `orq ask` (null after any later state change). */
export const TaskNow = Schema.Struct({ note: Schema.String, message: Schema.NullOr(Schema.String) })
export type TaskNow = typeof TaskNow.Type
