import { useState } from "react"
import { buildBoard } from "../board.ts"
import { useClock, usePolling, useRememberedProject, useSelectedTaskId } from "../hooks.ts"
import { fetchBoard } from "../serverApi.ts"
import { projectLabels } from "../tasks.ts"
import { Header } from "./Header.tsx"
import { NeedsYou } from "./NeedsYou.tsx"
import { RunningTasks } from "./RunningTasks.tsx"
import { TaskBoard } from "./TaskBoard.tsx"
import { TaskPanel } from "./TaskPanel.tsx"

/** orq's dashboard: what needs you on top, the board (or, on a phone, what runs), and the
 * selected task's panel. Read-only. */
export const App = () => {
  const polledBoard = usePolling(fetchBoard, [])
  const tasks = polledBoard.value
  const now = useClock()
  const [project, selectProject] = useRememberedProject()
  const [selectedId, selectTask] = useSelectedTaskId()
  const [boardShownOnPhone, setBoardShownOnPhone] = useState(false)

  const board = buildBoard(tasks, project, now)
  const selectedTask = tasks.find((task) => task.id === selectedId)

  return (
    <>
      <Header projects={projectLabels(tasks)} selectedProject={project} onSelectProject={selectProject} board={polledBoard} now={now} />
      <NeedsYou tasks={board.needsYou} selectedId={selectedId} onSelect={selectTask} now={now} />
      <div className={`body${boardShownOnPhone ? " show-board" : ""}`}>
        <TaskBoard columns={board.columns} selectedId={selectedId} onSelect={selectTask} now={now} />
        <RunningTasks
          tasks={board.running}
          onSelect={selectTask}
          boardShown={boardShownOnPhone}
          onToggleBoard={() => setBoardShownOnPhone(!boardShownOnPhone)}
          now={now}
        />
        {selectedTask && <TaskPanel key={selectedTask.id} task={selectedTask} now={now} onClose={() => selectTask(null)} />}
      </div>
    </>
  )
}
