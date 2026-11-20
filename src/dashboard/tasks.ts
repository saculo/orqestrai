// Facts about one task, as the page shows them: whether it waits for you, which project it is
// in, its pull request and Slack thread, and how long ago something happened.
import type { BoardTask, Status } from "./serverApi.ts"

const FINISHED: ReadonlyArray<Status> = ["MERGED", "DROPPED"]

export const isWaitingForYou = (status: Status) => status === "WAITING FOR ME" || status === "BLOCKED"

export const isFinished = (status: Status) => FINISHED.includes(status)

/** The last `parts` folder names of a repo path: `api`, or `client/api` with 2. */
const lastFolders = (repo: string, parts: number) => repo.split("/").filter(Boolean).slice(-parts).join("/") || repo

/** The project's short name: its repo's folder name. */
export const projectName = (task: BoardTask) => lastFolders(task.repo, 1)

/** Each repo's name for the project filter: its folder's name, or with its parent folder when
 * two repos share a name (`client/api`, `server/api`). */
export const projectLabels = (tasks: ReadonlyArray<BoardTask>): ReadonlyMap<string, string> => {
  const repos = [...new Set(tasks.map((task) => task.repo))]
  const sharesItsName = (repo: string) => repos.some((other) => other !== repo && lastFolders(other, 1) === lastFolders(repo, 1))
  return new Map(repos.map((repo) => [repo, lastFolders(repo, sharesItsName(repo) ? 2 : 1)]))
}

/** "42s", "5m", "3h", "2d": the time since `iso`. */
export const timeAgo = (iso: string, now: number) => {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

const linkedRef = (task: BoardTask, kind: string) => task.links.find((link) => link.kind === kind)?.ref

/** The task's pull request: its number as a label, and its URL when the link holds one. */
export const pullRequestOf = (task: BoardTask) => {
  const ref = linkedRef(task, "gh-pr")
  if (!ref) return null
  const number = /(?:pull\/|#)(\d+)/.exec(ref)?.[1]
  return { url: ref.startsWith("http") ? ref : null, label: number ? `#${number}` : "PR" }
}

/** The GitHub issue the task was started from (`orq issues`): its URL, and its number as a label. */
export const issueOf = (task: BoardTask) => {
  const url = linkedRef(task, "gh-issue")
  if (!url) return null
  return { url, label: `#${/\/issues\/(\d+)/.exec(url)?.[1] ?? "?"}` }
}

/** The task's Slack thread (`C123/1700000000.000100`), as a link Slack opens in your workspace. */
export const slackThreadUrl = (task: BoardTask) => {
  const ref = linkedRef(task, "slack-thread")
  if (!ref) return null
  const [channel, timestamp = ""] = ref.split("/")
  return `https://slack.com/archives/${channel}/p${timestamp.replace(".", "")}`
}
