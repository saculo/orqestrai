// The words of orqestrai: steps, statuses, tasks, links, events, and the one error the CLI reports.
// Every other module imports these; nothing defines them twice. The schemas check rows read
// from the database.
import { Schema } from "effect"

export const STEPS = ["triage", "plan", "impl", "verify", "learn", "ship"] as const
export const Step = Schema.Literals(STEPS)
export type Step = typeof Step.Type

export const STATUSES = ["TODO", "IN PROGRESS", "WAITING FOR ME", "BLOCKED", "DROPPED", "MERGED"] as const
export const Status = Schema.Literals(STATUSES)
export type Status = typeof Status.Type

export const TEMPLATES = ["BRIEF", "RESEARCH", "SPEC", "VERIFY", "LEARN", "PR"] as const

export const Task = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  title: Schema.String,
  branch: Schema.String,
  worktree: Schema.String,
  step: Step,
  status: Status,
  created_at: Schema.Date,
  updated_at: Schema.Date,
})
export type Task = typeof Task.Type

/** Where a task came from (origin) or what it relates to: an issue, a ticket, a thread, a PR.
 * The kind is open; the adapter that owns a kind is the only code that reads its ref. */
export const LINK_ROLES = ["origin", "related"] as const
export const LinkRole = Schema.Literals(LINK_ROLES)
export type LinkRole = typeof LinkRole.Type

export const TaskLink = Schema.Struct({ kind: Schema.String, ref: Schema.String, role: LinkRole })
export type TaskLink = typeof TaskLink.Type

export const TaskEvent = Schema.Struct({ at: Schema.Date, kind: Schema.String, detail: Schema.NullOr(Schema.String) })
export type TaskEvent = typeof TaskEvent.Type

/** A failure the user can act on. The CLI prints its message and exits 1; an MCP tool returns it as its error. */
export class OrqError extends Schema.TaggedError<OrqError>()("OrqError", { message: Schema.String }) {}

export const taskId = (n: number): string => `T-${String(n).padStart(4, "0")}`

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "") || "task"

/** A time as orq prints it: UTC, to the second. */
export const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ")
