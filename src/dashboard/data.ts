// What the dashboard reads from `orq serve` (src/dashboard.ts), as JSON: dates are ISO strings.
import { useCallback, useEffect, useState } from "react"
import type { Status, Step, Task, TaskEvent, TaskLink } from "../domain.ts"

type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] }

/** A task on the board: the row, its last state note, the message it waits on, its links. */
export type BoardTask = Json<Task> & { note: string; message: string | null; links: ReadonlyArray<TaskLink> }
export type Event = Json<TaskEvent>
export type Files = {
  /** false when the task's worktree is on another machine than orq serve */
  here: boolean
  files: ReadonlyArray<{ name: string; status: string | null }>
  /** image paths under the task's evidence folder */
  evidence: ReadonlyArray<string>
}

export const POLL_MS = 5000

/** The steps, in order. Not imported from domain.ts, which would bring Effect into the page;
 * the check below fails to compile when the two lists disagree. */
export const STEPS = ["triage", "plan", "impl", "verify", "learn", "ship"] as const satisfies ReadonlyArray<Step>
const sameSteps: Exclude<Step, (typeof STEPS)[number]> extends never ? true : false = true
void sameSteps

export const getJson = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

export const getText = async (url: string): Promise<string | null> => {
  const r = await fetch(url, { cache: "no-store" })
  return r.ok ? r.text() : null
}

/** `load` now and every POLL_MS; the last value, and when the last call failed. */
export const usePoll = <T>(load: () => Promise<T>, initial: T) => {
  const [value, setValue] = useState<T>(initial)
  const [at, setAt] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const run = useCallback(
    () =>
      load().then(
        (v) => {
          setValue(v)
          setAt(Date.now())
          setFailed(false)
        },
        () => setFailed(true),
      ),
    [load],
  )
  useEffect(() => {
    run()
    const timer = setInterval(run, POLL_MS)
    return () => clearInterval(timer)
  }, [run])
  return { value, at, failed }
}

export const waits = (s: Status) => s === "WAITING FOR ME" || s === "BLOCKED"
export const DONE: ReadonlyArray<Status> = ["MERGED", "DROPPED"]
export const project = (t: BoardTask) => t.repo.split("/").filter(Boolean).pop() ?? t.repo

export const ago = (iso: string, now = Date.now()) => {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const linkRef = (t: BoardTask, kind: string) => t.links.find((l) => l.kind === kind)?.ref

export const prOf = (t: BoardTask) => {
  const ref = linkRef(t, "gh-pr")
  if (!ref) return null
  const n = /(?:pull\/|#)(\d+)/.exec(ref)?.[1]
  return { url: ref.startsWith("http") ? ref : null, label: n ? `#${n}` : "PR" }
}

/** The task's Slack thread (`C123/1700000000.000100`), as a link Slack resolves to your workspace. */
export const slackOf = (t: BoardTask) => {
  const ref = linkRef(t, "slack-thread")
  if (!ref) return null
  const [channel, ts = ""] = ref.split("/")
  return `https://slack.com/archives/${channel}/p${ts.replace(".", "")}`
}
