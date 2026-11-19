import type { BoardTask } from "../serverApi.ts"
import { timeAgo } from "../tasks.ts"

type Props = {
  tasks: ReadonlyArray<BoardTask>
  onSelect: (taskId: string) => void
  boardShown: boolean
  onToggleBoard: () => void
  now: number
}

/** On a phone, the board's place: a short list of the tasks being worked on, and a button for
 * the whole board. Hidden on wider screens (style.css). */
export const RunningTasks = ({ tasks, onSelect, boardShown, onToggleBoard, now }: Props) => (
  <section className="running" aria-labelledby="running-h">
    <h2 className="label" id="running-h">
      Running · {tasks.length}
    </h2>
    <div className="list">
      {tasks.length === 0 && <p className="empty pad">Nothing running.</p>}
      {tasks.map((task) => (
        <button key={task.id} type="button" className="row-task" onClick={() => onSelect(task.id)}>
          <span className="mono small">{task.id}</span>
          <span className="stack">
            <span className="t">{task.title}</span>
            <span className="small">
              {task.step} · {task.note || task.status}
            </span>
          </span>
          <span className="small">{timeAgo(task.updated_at, now)}</span>
        </button>
      ))}
    </div>
    <button type="button" className="linkbtn" onClick={onToggleBoard}>
      {boardShown ? "Hide the board" : "Show the board"}
    </button>
  </section>
)
