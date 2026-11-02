// The words of orqestrai: steps, statuses, tasks, and the one error the CLI reports.
// Every other module imports these; nothing defines them twice.
import { Data } from "effect"

export const STEPS = ["triage", "plan", "impl", "verify", "learn", "ship"] as const
export type Step = (typeof STEPS)[number]

export const STATUSES = ["TODO", "IN PROGRESS", "WAITING FOR ME", "BLOCKED", "MERGED"] as const
export type Status = (typeof STATUSES)[number]

export const TEMPLATES = ["BRIEF", "RESEARCH", "SPEC"] as const
export type TemplateName = (typeof TEMPLATES)[number]

export interface Task {
  readonly id: string
  readonly repo: string
  readonly title: string
  readonly branch: string
  readonly worktree: string
  readonly step: Step
  readonly status: Status
  readonly pr_url: string | null
  readonly slack_thread: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface TaskEvent {
  readonly at: string
  readonly kind: string
  readonly detail: string | null
}

/** A failure the user can act on. The CLI prints its message and exits 1. */
export class OrqError extends Data.TaggedError("OrqError")<{ readonly message: string }> {}

export const taskId = (n: number): string => `T-${String(n).padStart(4, "0")}`

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "") || "task"
