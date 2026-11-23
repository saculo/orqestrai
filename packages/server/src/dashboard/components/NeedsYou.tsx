import type { BoardTask } from "../serverApi.ts"
import { projectName, timeAgo } from "../tasks.ts"
import { StatusChip } from "./StatusChip.tsx"

type Props = { tasks: ReadonlyArray<BoardTask>; selectedId: string | null; onSelect: (taskId: string) => void; now: number }

/** The tasks waiting for your answer, on top of the page. */
export const NeedsYou = ({ tasks, selectedId, onSelect, now }: Props) => (
  <section className="needs" aria-labelledby="needs-h">
    <h2 className="label" id="needs-h">
      Needs you · {tasks.length}
    </h2>
    <div className="needs-grid">
      {tasks.length === 0 && <p className="empty">Nothing waits for you.</p>}
      {tasks.map((task) => (
        <WaitingTask key={task.id} task={task} selected={task.id === selectedId} onSelect={onSelect} now={now} />
      ))}
    </div>
  </section>
)

const WaitingTask = ({
  task,
  selected,
  onSelect,
  now,
}: {
  task: BoardTask
  selected: boolean
  onSelect: (taskId: string) => void
  now: number
}) => (
  <button
    type="button"
    className={`need${task.status === "BLOCKED" ? " blocked" : ""}`}
    aria-current={selected}
    onClick={() => onSelect(task.id)}
  >
    <span className="head">
      <span className="mono small">{task.id}</span>
      <StatusChip status={task.status} />
      <span className="age">{timeAgo(task.updated_at, now)}</span>
    </span>
    <span className="note">{task.note || task.title}</span>
    <span className="small">
      {projectName(task)} · {task.step} · {task.title}
    </span>
  </button>
)
