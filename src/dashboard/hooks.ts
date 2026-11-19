// The page's React hooks: polling the server, a clock for "5m ago", the selected task in the
// URL, and the project filter remembered in the browser.
import { useCallback, useEffect, useRef, useState } from "react"
import { ALL_PROJECTS } from "./board.ts"

export const POLL_MS = 5000

export type Polled<T> = {
  value: T
  /** when the last answer arrived, or null before the first */
  updatedAt: number | null
  /** the last request failed */
  failed: boolean
}

/** Calls `load` now and every POLL_MS. A response older than one already shown is dropped (a
 * slow request must not undo a newer one), and a new `load` (another task, another file)
 * starts again from `initial`, never with the old value. */
export const usePolling = <T>(load: () => Promise<T>, initial: T): Polled<T> => {
  const initialValue = useRef(initial)
  const [polled, setPolled] = useState<Polled<T>>({ value: initial, updatedAt: null, failed: false })

  useEffect(() => {
    let mounted = true
    let lastStarted = 0
    let lastShown = 0
    setPolled({ value: initialValue.current, updatedAt: null, failed: false })

    const poll = () => {
      const request = ++lastStarted
      load().then(
        (value) => {
          if (!mounted || request < lastShown) return
          lastShown = request
          setPolled({ value, updatedAt: Date.now(), failed: false })
        },
        () => {
          if (mounted && request >= lastShown) setPolled((previous) => ({ ...previous, failed: true }))
        },
      )
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [load])

  return polled
}

/** The time now, renewed every POLL_MS, so "3m ago" stays true between polls. */
export const useClock = () => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

const taskIdFromHash = () => location.hash.slice(1) || null

/** The selected task's id, kept in the URL's hash (`#T-0001`), so a link opens that task. */
export const useSelectedTaskId = () => {
  const [selected, setSelected] = useState<string | null>(taskIdFromHash)

  useEffect(() => {
    const followHash = () => setSelected(taskIdFromHash())
    window.addEventListener("hashchange", followHash)
    return () => window.removeEventListener("hashchange", followHash)
  }, [])

  const select = useCallback((taskId: string | null) => {
    setSelected(taskId)
    history.replaceState(null, "", taskId ? `#${taskId}` : location.pathname)
  }, [])

  return [selected, select] as const
}

const PROJECT_KEY = "orq.repo"

const rememberedProject = () => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ALL_PROJECTS
  } catch {
    return ALL_PROJECTS
  }
}

/** The project filter (a repo path, or ALL_PROJECTS), remembered by this browser
 * (localStorage). Works, without remembering, where the browser refuses storage. */
export const useRememberedProject = () => {
  const [project, setProject] = useState(rememberedProject)

  const selectProject = useCallback((repo: string) => {
    setProject(repo)
    try {
      localStorage.setItem(PROJECT_KEY, repo)
    } catch {}
  }, [])

  return [project, selectProject] as const
}
