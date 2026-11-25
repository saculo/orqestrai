// What the page shows of all the tasks: which ones need you, which run, and the board's columns.
// Pure: the same tasks, filter and time always give the same board.
import { type BoardTask, STEPS } from "./serverApi.ts"
import { isFinished, isWaitingForYou } from "./tasks.ts"

/** Finished tasks stay on the board this long, then leave it. */
export const FINISHED_TASKS_SHOWN_FOR_MS = 3 * 86_400_000

/** The project filter's value that shows every project. */
export const ALL_PROJECTS = "all"

export type BoardColumn = { name: string; tasks: ReadonlyArray<BoardTask> }

export type Board = {
  /** WAITING FOR ME and BLOCKED tasks: BLOCKED first, then the longest waiting first. */
  needsYou: ReadonlyArray<BoardTask>
  /** Tasks added but not started (no worktree yet), not finished. They are in no step column. */
  backlog: ReadonlyArray<BoardTask>
  /** Tasks being worked on now, the phone's list. */
  running: ReadonlyArray<BoardTask>
  /** One column per step, then "done". */
  columns: ReadonlyArray<BoardColumn>
}

const isInProject = (repo: string) => (task: BoardTask) => repo === ALL_PROJECTS || task.repo === repo

const isStillShown = (now: number) => (task: BoardTask) =>
  !isFinished(task.status) || now - new Date(task.updated_at).getTime() < FINISHED_TASKS_SHOWN_FOR_MS

const blockedFirstThenLongestWaiting = (a: BoardTask, b: BoardTask) => {
  if (a.status !== b.status) return a.status === "BLOCKED" ? -1 : 1
  return a.updated_at.localeCompare(b.updated_at)
}

const isStarted = (task: BoardTask) => task.worktree !== null

const isInBacklog = (task: BoardTask) => !isStarted(task) && !isFinished(task.status)

const isRunning = (task: BoardTask) => isStarted(task) && !isWaitingForYou(task.status) && !isFinished(task.status)

const stepColumns = (tasks: ReadonlyArray<BoardTask>): ReadonlyArray<BoardColumn> => [
  ...STEPS.map((step) => ({
    name: step,
    tasks: tasks.filter((task) => task.step === step && isStarted(task) && !isFinished(task.status)),
  })),
  { name: "done", tasks: tasks.filter((task) => isFinished(task.status)) },
]

/** The board for the tasks of one repo (or ALL_PROJECTS), at time `now`. */
export const buildBoard = (tasks: ReadonlyArray<BoardTask>, repo: string, now: number): Board => {
  const shown = tasks.filter(isInProject(repo)).filter(isStillShown(now))
  return {
    needsYou: shown.filter((task) => isStarted(task) && isWaitingForYou(task.status)).sort(blockedFirstThenLongestWaiting),
    backlog: shown.filter(isInBacklog),
    running: shown.filter(isRunning),
    columns: stepColumns(shown),
  }
}
