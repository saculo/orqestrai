// A task's files as the panel shows them: which tabs, which one opens first, and where a link
// inside a file's Markdown goes.
import { evidenceUrl, FILE_NAMES, type FileName, type TaskFiles, taskFileUrl } from "./serverApi.ts"

/** These tabs show even before their file exists, so the steps ahead are visible. */
const ALWAYS_SHOWN: ReadonlyArray<FileName> = ["REQUEST", "BRIEF", "SPEC", "VERIFY", "PR"]

/** Each written file's frontmatter status (null when it has none). */
export const writtenFiles = (files: TaskFiles): ReadonlyMap<FileName, string | null> =>
  new Map(files.files.map((file) => [file.name, file.status]))

/** The tabs, in the order of the steps: the written files and the ones always shown. */
export const fileTabs = (written: ReadonlyMap<FileName, string | null>) =>
  FILE_NAMES.filter((name) => written.has(name) || ALWAYS_SHOWN.includes(name))

/** The tab that opens first: the latest step's file. */
export const latestFile = (written: ReadonlyMap<FileName, string | null>): FileName =>
  [...FILE_NAMES].reverse().find((name) => written.has(name)) ?? "REQUEST"

const isFileName = (name: string): name is FileName => (FILE_NAMES as ReadonlyArray<string>).includes(name)

const hasScheme = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url)

/** Where a link in the task's Markdown goes, when it is relative to the task's folder:
 * `evidence/V1/x.png` to the evidence route, `SPEC.md` to the file route. Null for any other
 * link (absolute, an anchor, or something the server does not serve). */
export const taskLinkTarget = (taskId: string, url: string): string | null => {
  if (hasScheme(url) || url.startsWith("/") || url.startsWith("#")) return null
  const path = url.replace(/^\.\//, "")
  if (path.startsWith("evidence/") && !path.split("/").includes(".."))
    return evidenceUrl(taskId, decodeURIComponent(path.slice("evidence/".length)))
  const name = /^([A-Z]+)\.md$/.exec(path)?.[1]
  return name && isFileName(name) ? taskFileUrl(taskId, name) : null
}
