import type { BoardTask } from "../serverApi.ts"
import { issueOf, isWaitingForYou, projectName, pullRequestOf, timeAgo } from "../tasks.ts"
import { CloseIcon } from "./icons.tsx"
import { StatusChip } from "./StatusChip.tsx"
import { TaskFileViewer } from "./TaskFileViewer.tsx"
import { TaskMarkdown } from "./TaskMarkdown.tsx"
import { Timeline } from "./Timeline.tsx"

type Props = { task: BoardTask; now: number; onClose: () => void }

/** One task: its header and links, the message it waits on, its files and its timeline. */
export const TaskPanel = ({ task, now, onClose }: Props) => (
  <aside className="panel" aria-label={`Task ${task.id}`}>
    <PanelHeader task={task} onClose={onClose} />
    {isWaitingForYou(task.status) && <WaitingMessage task={task} now={now} />}
    <TaskFileViewer taskId={task.id} />
    <Timeline taskId={task.id} now={now} />
  </aside>
)

const PanelHeader = ({ task, onClose }: { task: BoardTask; onClose: () => void }) => (
  <div className="p-head">
    <div className="row">
      <span className="mono muted">{task.id}</span>
      <StatusChip status={task.status} />
      <button type="button" className="close" aria-label="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
    <h2>{task.title}</h2>
    <div className="meta">
      <span>{projectName(task)}</span>
      <span>playbook {task.type ?? "not chosen yet"}</span>
      <span>step {task.step}</span>
      <span className="mono">{task.branch}</span>
    </div>
    <TaskLinks task={task} />
  </div>
)

/** The task's issue and pull request, when it has them. */
const TaskLinks = ({ task }: { task: BoardTask }) => {
  const issue = issueOf(task)
  const pullRequest = pullRequestOf(task)
  if (!issue && !pullRequest?.url) return null
  return (
    <div className="meta links">
      {issue && (
        <a href={issue.url} target="_blank" rel="noopener noreferrer">
          Issue {issue.label} on GitHub ↗
        </a>
      )}
      {pullRequest?.url && (
        <a href={pullRequest.url} target="_blank" rel="noopener noreferrer">
          PR {pullRequest.label} on GitHub ↗
        </a>
      )}
    </div>
  )
}

/** The whole message the task waits on, and where to answer it. */
const WaitingMessage = ({ task, now }: { task: BoardTask; now: number }) => {
  const blocked = task.status === "BLOCKED"
  const heading = blocked ? "Blocked" : "Waiting for you"
  return (
    <section className={`msg${blocked ? " blocked" : ""}`} aria-label={heading}>
      <p className="label">
        {heading} · {timeAgo(task.updated_at, now)} ago
      </p>
      <TaskMarkdown text={task.message ?? task.note} taskId={task.id} />
      <p className="small answer">
        Answer in its session: the Herdr app, or <span className="mono">hc attach orq-{task.id.toLowerCase()}</span>
      </p>
    </section>
  )
}
