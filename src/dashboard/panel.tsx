// One task: its header and links, the message it waits on, its files as tabs (with the verify
// screenshots), and its timeline.
import { useCallback, useState } from "react"
import {
  ago,
  type BoardTask,
  type Event,
  FILE_NAMES,
  type Files,
  getJson,
  getText,
  prOf,
  project,
  slackOf,
  usePoll,
  waits,
} from "./data.ts"
import { Md, StatusChip } from "./parts.tsx"

const TABS: ReadonlyArray<string> = FILE_NAMES
/** Shown even before the file exists, so the steps ahead are visible. */
const ALWAYS = ["REQUEST", "BRIEF", "SPEC", "VERIFY", "PR"]
const NO_FILES: Files = { files: [], evidence: [] }

const evidenceUrl = (id: string, path: string) => `tasks/${id}/evidence/${path.split("/").map(encodeURIComponent).join("/")}`

export const Panel = ({ task, now, onClose }: { task: BoardTask; now: number; onClose: () => void }) => {
  const id = task.id
  const loadEvents = useCallback(() => getJson<ReadonlyArray<Event>>(`tasks/${id}/events?limit=40`), [id])
  const loadFiles = useCallback(() => getJson<Files>(`tasks/${id}/files`), [id])
  const events = usePoll(loadEvents, [])
  const files = usePoll(loadFiles, NO_FILES)

  const have = new Map(files.value.files.map((f) => [f.name, f.status]))
  const latest = [...TABS].reverse().find((t) => have.has(t)) ?? "REQUEST"
  const [chosen, setChosen] = useState<string | null>(null)
  const tab = chosen ?? latest

  // the open file, polled like the rest: a session may rewrite it at any time
  const status = have.get(tab)
  const written = have.has(tab)
  const loadText = useCallback(() => (written ? getText(`tasks/${id}/files/${tab}`) : Promise.resolve(null)), [id, tab, written])
  const { value: text } = usePoll(loadText, null)

  const pr = prOf(task)
  const slack = slackOf(task)
  const blocked = task.status === "BLOCKED"

  return (
    <aside className="panel" aria-label={`Task ${id}`}>
      <div className="p-head">
        <div className="row">
          <span className="mono muted">{id}</span>
          <StatusChip status={task.status} />
          <button type="button" className="close" aria-label="Close" onClick={onClose}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--fg2)"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <h2>{task.title}</h2>
        <div className="meta">
          <span>{project(task)}</span>
          <span>playbook {task.type ?? "not chosen yet"}</span>
          <span>step {task.step}</span>
          <span className="mono">{task.branch}</span>
        </div>
        {(slack || pr?.url) && (
          <div className="meta links">
            {slack && (
              <a href={slack} target="_blank" rel="noopener noreferrer">
                Slack thread ↗
              </a>
            )}
            {pr?.url && (
              <a href={pr.url} target="_blank" rel="noopener noreferrer">
                PR {pr.label} on GitHub ↗
              </a>
            )}
          </div>
        )}
      </div>

      {waits(task.status) && (
        <section className={`msg${blocked ? " blocked" : ""}`} aria-label={blocked ? "Blocked" : "Waiting for you"}>
          <p className="label">
            {blocked ? "Blocked" : "Waiting for you"} · {ago(task.updated_at, now)} ago
          </p>
          <Md text={task.message ?? task.note} task={id} />
          <p className="small answer">
            Answer {slack ? "in the Slack thread, or " : ""}in the session: <span className="mono">orq open {id}</span>
          </p>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="Task files">
        {TABS.filter((t) => have.has(t) || ALWAYS.includes(t)).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={`tab${have.has(t) ? "" : " missing"}`}
            aria-selected={t === tab}
            onClick={() => setChosen(t)}
          >
            {t}
            <span className={`st st-${have.get(t) ?? "none"}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="file" role="tabpanel">
        <p className="small">
          {tab}.md · {have.has(tab) ? (status ?? "written") : "not written yet"}
        </p>
        {text !== null && <Md text={text} task={id} />}
        {tab === "VERIFY" && files.value.evidence.length > 0 && (
          <div className="shots">
            {files.value.evidence.map((p) => (
              <figure key={p}>
                <a href={evidenceUrl(id, p)} target="_blank" rel="noopener noreferrer">
                  <img loading="lazy" alt={p} src={evidenceUrl(id, p)} />
                </a>
                <figcaption>{p}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <section className="timeline" aria-label="Timeline">
        <h3 className="label">Timeline</h3>
        {events.value
          .filter((e) => e.kind !== "message")
          .map((e) => (
            <div key={`${e.at}|${e.kind}|${e.detail}`} className="ev">
              <span className="muted">{ago(e.at, now)}</span>
              <span>
                {e.kind}
                {e.detail ? ` · ${e.detail}` : ""}
              </span>
            </div>
          ))}
        {events.at === null && <p className="empty">loading</p>}
      </section>
    </aside>
  )
}
