// What the page reads from `orq serve` (src/dashboard.ts): the shapes of its JSON, and one
// function per request. Dates arrive as ISO strings. Only types come from domain.ts: importing
// its values would bring Effect into the page.
import type { TaskEvent as DomainEvent, Status, Step, TASK_FILES, Task, TaskLink } from "../domain.ts"

type AsJson<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] }

/** A task on the board: its row, its last state note, the message it waits on, its links. */
export type BoardTask = AsJson<Task> & { note: string; message: string | null; links: ReadonlyArray<TaskLink> }
export type TaskEvent = AsJson<DomainEvent>
export type { Status }

/** The server's copy of a task's files, as the CLI last sent it (src/files.ts). */
export type TaskFiles = {
  files: ReadonlyArray<{ name: FileName; status: string | null }>
  /** image paths under the task's evidence folder, such as `V1/V1-list.png` */
  evidence: ReadonlyArray<string>
}

/** The steps, in order. The check below fails to compile when they differ from domain.ts. */
export const STEPS = ["triage", "plan", "impl", "verify", "learn", "ship"] as const satisfies ReadonlyArray<Step>
const stepsMatchDomain: Exclude<Step, (typeof STEPS)[number]> extends never ? true : false = true
void stepsMatchDomain

/** The task files, in the order of the steps; checked against domain.ts the same way. */
export const FILE_NAMES = ["REQUEST", "RESEARCH", "BRIEF", "SPEC", "VERIFY", "LEARN", "PR"] as const satisfies ReadonlyArray<
  (typeof TASK_FILES)[number]
>
export type FileName = (typeof FILE_NAMES)[number]
const filesMatchDomain: Exclude<(typeof TASK_FILES)[number], FileName> extends never ? true : false = true
void filesMatchDomain

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

/** The URLs are relative, so the page works under any address `orq serve` has. */
export const fetchBoard = () => getJson<ReadonlyArray<BoardTask>>("board")
export const fetchTaskEvents = (taskId: string) => getJson<ReadonlyArray<TaskEvent>>(`tasks/${taskId}/events?limit=40`)
export const fetchTaskFiles = (taskId: string) => getJson<TaskFiles>(`tasks/${taskId}/files`)

/** A task file's Markdown, or null when the server has none. */
export const fetchTaskFileText = async (taskId: string, name: FileName): Promise<string | null> => {
  const response = await fetch(taskFileUrl(taskId, name), { cache: "no-store" })
  return response.ok ? response.text() : null
}

export const taskFileUrl = (taskId: string, name: FileName) => `tasks/${taskId}/files/${name}`

/** `path` is relative to the evidence folder, such as `V1/V1-list.png`. */
export const evidenceUrl = (taskId: string, path: string) => `tasks/${taskId}/evidence/${path.split("/").map(encodeURIComponent).join("/")}`
