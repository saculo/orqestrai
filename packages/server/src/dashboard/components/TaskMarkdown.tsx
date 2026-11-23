import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { taskLinkTarget } from "../taskFiles.ts"

const withoutFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
const withoutHtmlComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "")

const ExternalLink = ({ href, children }: { href?: string; children?: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
)

/** A task file or a message, as GitHub Markdown, without the frontmatter and HTML comments.
 * Raw HTML is never rendered (react-markdown's default). Links relative to the task's folder
 * (`evidence/…`, `SPEC.md`) go to the task's own routes; others keep react-markdown's safe
 * default, and open in a new tab. */
export const TaskMarkdown = ({ text, taskId }: { text: string; taskId: string }) => (
  <div className="md">
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => taskLinkTarget(taskId, url) ?? defaultUrlTransform(url)}
      components={{ a: ExternalLink }}
    >
      {withoutHtmlComments(withoutFrontmatter(text))}
    </Markdown>
  </div>
)
