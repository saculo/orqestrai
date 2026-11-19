import type { BoardTask } from "../serverApi.ts"
import { projectName, pullRequestOf } from "../tasks.ts"
import { StatusChip } from "./StatusChip.tsx"

/** A card's footer: status, project, playbook and pull request. */
export const TaskTags = ({ task }: { task: BoardTask }) => {
  const pullRequest = pullRequestOf(task)
  return (
    <span className="tags">
      <StatusChip status={task.status} />
      <span className="tag">{projectName(task)}</span>
      <span className="tag">{task.type ?? "choosing"}</span>
      {pullRequest && <span className="tag pr">PR {pullRequest.label}</span>}
    </span>
  )
}
