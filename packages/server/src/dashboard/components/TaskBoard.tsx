import type { BoardColumn } from "../board.ts"
import type { BoardTask } from "../serverApi.ts"
import { timeAgo } from "../tasks.ts"
import { TaskTags } from "./TaskTags.tsx"

type Props = { columns: ReadonlyArray<BoardColumn>; selectedId: string | null; onSelect: (taskId: string) => void; now: number }

/** The board: one column per step, then the finished tasks. */
export const TaskBoard = ({ columns, selectedId, onSelect, now }: Props) => (
  <main className="board" aria-label="Board">
    <div className="cols">
      {columns.map((column) => (
        <section key={column.name} className="col" aria-label={column.name}>
          <h3 className="label">
            <span>{column.name}</span>
            <span>{column.tasks.length}</span>
          </h3>
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} selected={task.id === selectedId} onSelect={onSelect} now={now} />
          ))}
        </section>
      ))}
    </div>
  </main>
)

const TaskCard = ({
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
  <button type="button" className="card" aria-current={selected} onClick={() => onSelect(task.id)}>
    <span className="head">
      <span className="mono small">{task.id}</span>
      <span className="age">{timeAgo(task.updated_at, now)}</span>
    </span>
    <span className="title">{task.title}</span>
    {task.note && <span className="note">{task.note}</span>}
    <TaskTags task={task} />
  </button>
)
