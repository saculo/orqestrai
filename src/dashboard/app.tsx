// orq's dashboard: one read-only page. The board of tasks by step, what needs you on top, and a
// panel for one task (the message it waits on, its files, its evidence, its timeline).
// Bun bundles it from index.html (src/dashboard.ts); styles in style.css.
import { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { ago, type BoardTask, DONE, getJson, POLL_MS, project, STEPS, usePoll, waits } from "./data.ts"
import { Panel } from "./panel.tsx"
import { StatusChip, Tags } from "./parts.tsx"

const DONE_DAYS = 3

const loadBoard = () => getJson<ReadonlyArray<BoardTask>>("board")

const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

/** Re-renders every few seconds, so "3m ago" stays true between polls. */
const useNow = () => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

const App = () => {
  const { value: tasks, at, failed } = usePoll(loadBoard, [])
  const now = useNow()
  const [filter, setFilter] = useState(readLocal("orq.project") ?? "all")
  const [selected, setSelected] = useState<string | null>(location.hash.slice(1) || null)
  const [boardOnPhone, setBoardOnPhone] = useState(false)

  const select = useCallback((id: string | null) => {
    setSelected(id)
    history.replaceState(null, "", id ? `#${id}` : location.pathname)
  }, [])
  useEffect(() => {
    const onHash = () => setSelected(location.hash.slice(1) || null)
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const projects = ["all", ...new Set(tasks.map(project))]
  const fresh = (t: BoardTask) => !DONE.includes(t.status) || now - new Date(t.updated_at).getTime() < DONE_DAYS * 86_400_000
  const shown = tasks.filter((t) => (filter === "all" || project(t) === filter) && fresh(t))
  const needs = shown
    .filter((t) => waits(t.status))
    .sort((a, b) => (a.status === b.status ? a.updated_at.localeCompare(b.updated_at) : a.status === "BLOCKED" ? -1 : 1))
  const running = shown.filter((t) => !waits(t.status) && !DONE.includes(t.status))
  const columns = [
    ...STEPS.map((step) => ({ name: step, tasks: shown.filter((t) => t.step === step && !DONE.includes(t.status)) })),
    { name: "done", tasks: shown.filter((t) => DONE.includes(t.status)) },
  ]
  const open = tasks.find((t) => t.id === selected)

  return (
    <>
      <header className="top">
        <div className="logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="5" height="16" rx="1.5" />
            <rect x="10" y="4" width="5" height="10" rx="1.5" />
            <rect x="17" y="4" width="4" height="13" rx="1.5" />
          </svg>
          orq
        </div>
        <nav className="pills" aria-label="Projects">
          {projects.map((p) => (
            <button
              key={p}
              type="button"
              className="pill"
              aria-pressed={p === filter}
              onClick={() => {
                setFilter(p)
                writeLocal("orq.project", p)
              }}
            >
              {p === "all" ? "All projects" : p}
            </button>
          ))}
        </nav>
        <div className={`live${failed ? " down" : ""}`}>
          <span className="dot" aria-hidden="true" />
          {failed ? "orq serve unreachable" : at === null ? "loading" : `live · updated ${ago(new Date(at).toISOString(), now)} ago`}
        </div>
      </header>

      <section className="needs" aria-labelledby="needs-h">
        <h2 className="label" id="needs-h">
          Needs you · {needs.length}
        </h2>
        <div className="needs-grid">
          {needs.length === 0 && <p className="empty">Nothing waits for you.</p>}
          {needs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`need${t.status === "BLOCKED" ? " blocked" : ""}`}
              aria-current={t.id === selected}
              onClick={() => select(t.id)}
            >
              <span className="head">
                <span className="mono small">{t.id}</span>
                <StatusChip status={t.status} />
                <span className="age">{ago(t.updated_at, now)}</span>
              </span>
              <span className="note">{t.note || t.title}</span>
              <span className="small">
                {project(t)} · {t.step} · {t.title}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className={`body${boardOnPhone ? " show-board" : ""}`}>
        <main className="board" aria-label="Board">
          <div className="cols">
            {columns.map((c) => (
              <section key={c.name} className="col" aria-label={c.name}>
                <h3 className="label">
                  <span>{c.name}</span>
                  <span>{c.tasks.length}</span>
                </h3>
                {c.tasks.map((t) => (
                  <button key={t.id} type="button" className="card" aria-current={t.id === selected} onClick={() => select(t.id)}>
                    <span className="head">
                      <span className="mono small">{t.id}</span>
                      <span className="age">{ago(t.updated_at, now)}</span>
                    </span>
                    <span className="title">{t.title}</span>
                    {t.note && <span className="note">{t.note}</span>}
                    <Tags task={t} />
                  </button>
                ))}
              </section>
            ))}
          </div>
        </main>

        <section className="running" aria-labelledby="running-h">
          <h2 className="label" id="running-h">
            Running · {running.length}
          </h2>
          <div className="list">
            {running.length === 0 && <p className="empty pad">Nothing running.</p>}
            {running.map((t) => (
              <button key={t.id} type="button" className="row-task" onClick={() => select(t.id)}>
                <span className="mono small">{t.id}</span>
                <span className="stack">
                  <span className="t">{t.title}</span>
                  <span className="small">
                    {t.step} · {t.note || t.status}
                  </span>
                </span>
                <span className="small">{ago(t.updated_at, now)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="linkbtn" onClick={() => setBoardOnPhone(!boardOnPhone)}>
            {boardOnPhone ? "Hide the board" : "Show the board"}
          </button>
        </section>

        {open && <Panel key={open.id} task={open} now={now} onClose={() => select(null)} />}
      </div>
    </>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
