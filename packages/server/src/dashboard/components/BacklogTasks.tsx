import type { BoardTask } from "../serverApi.ts"
import { projectName, timeAgo } from "../tasks.ts"

type Props = { tasks: ReadonlyArray<BoardTask>; onSelect: (taskId: string) => void; now: number }

/** Tasks added but not started yet. Shown next to the running tasks. */
export const BacklogTasks = ({ tasks, onSelect, now }: Props) => (
  <section className="running backlog" aria-labelledby="backlog-h">
    <h2 className="label" id="backlog-h">
      Backlog · {tasks.length}
    </h2>
    <div className="list">
      {tasks.length === 0 && <p className="empty pad">Backlog is empty.</p>}
      {tasks.map((task) => (
        <button key={task.id} type="button" className="row-task" onClick={() => onSelect(task.id)}>
          <span className="mono small">{task.id}</span>
          <span className="stack">
            <span className="t">{task.title}</span>
            <span className="small">{projectName(task)}</span>
          </span>
          <span className="small">{timeAgo(task.created_at, now)}</span>
        </button>
      ))}
    </div>
  </section>
)
