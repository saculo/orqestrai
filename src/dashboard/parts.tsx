// Small pieces the board and the panel share.
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Status } from "../domain.ts"
import { type BoardTask, prOf, project } from "./data.ts"

const statusClass: Record<Status, string> = {
  "WAITING FOR ME": "s-waiting",
  BLOCKED: "s-blocked",
  "IN PROGRESS": "s-progress",
  TODO: "s-todo",
  MERGED: "s-merged",
  DROPPED: "s-dropped",
}

export const StatusChip = ({ status }: { status: Status }) => <span className={`chip ${statusClass[status]}`}>{status}</span>

export const Tags = ({ task }: { task: BoardTask }) => {
  const pr = prOf(task)
  return (
    <span className="tags">
      <StatusChip status={task.status} />
      <span className="tag">{project(task)}</span>
      <span className="tag">{task.type ?? "choosing"}</span>
      {pr && <span className="tag pr">PR {pr.label}</span>}
    </span>
  )
}

/** A task file or a message: GitHub Markdown, without the frontmatter and HTML comments. Raw
 * HTML is never rendered (react-markdown's default), and links open in a new tab. */
export const Md = ({ text }: { text: string }) => (
  <div className="md">
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "")}
    </Markdown>
  </div>
)
