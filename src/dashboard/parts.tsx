// Small pieces the board and the panel share.
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Status } from "../domain.ts"
import { type BoardTask, FILE_NAMES, prOf, project } from "./data.ts"

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

/** A link in a task's Markdown, relative to its folder, as the page reaches it: `evidence/…`
 * through the evidence route, `SPEC.md` through the file route. Anything else (absolute URLs,
 * anchors) as react-markdown's default makes it, which drops unsafe schemes. */
const taskUrl = (task: string) => (url: string) => {
  const safe = defaultUrlTransform(url)
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return safe
  const path = url.replace(/^\.\//, "")
  if (path.startsWith("evidence/") && !path.split("/").includes("..")) return `tasks/${task}/${path}`
  const name = /^([A-Z]+)\.md$/.exec(path)?.[1]
  if (name && (FILE_NAMES as ReadonlyArray<string>).includes(name)) return `tasks/${task}/files/${name}`
  return safe
}

/** A task file or a message: GitHub Markdown, without the frontmatter and HTML comments. Raw
 * HTML is never rendered (react-markdown's default), and links open in a new tab. */
export const Md = ({ text, task }: { text: string; task: string }) => (
  <div className="md">
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={taskUrl(task)}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/<!--[\s\S]*?-->/g, "")}
    </Markdown>
  </div>
)
