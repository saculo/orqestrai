import { useCallback, useState } from "react"
import { usePolling } from "../hooks.ts"
import { evidenceUrl, type FileName, fetchTaskFiles, fetchTaskFileText, type TaskFiles } from "../serverApi.ts"
import { fileTabs, latestFile, writtenFiles } from "../taskFiles.ts"
import { TaskMarkdown } from "./TaskMarkdown.tsx"

const NO_FILES: TaskFiles = { files: [], evidence: [] }

/** The task's files as tabs, the open one rendered, and the verify screenshots under VERIFY.
 * Polled: a session may rewrite a file at any time. */
export const TaskFileViewer = ({ taskId }: { taskId: string }) => {
  const loadFiles = useCallback(() => fetchTaskFiles(taskId), [taskId])
  const { value: files } = usePolling(loadFiles, NO_FILES)
  const written = writtenFiles(files)
  const [chosenTab, setChosenTab] = useState<FileName | null>(null)
  const openTab = chosenTab ?? latestFile(written)

  return (
    <>
      <FileTabs tabs={fileTabs(written)} written={written} open={openTab} onOpen={setChosenTab} />
      <div className="file" role="tabpanel">
        <OpenFile taskId={taskId} name={openTab} isWritten={written.has(openTab)} status={written.get(openTab) ?? null} />
        {openTab === "VERIFY" && <EvidenceGallery taskId={taskId} paths={files.evidence} />}
      </div>
    </>
  )
}

const FileTabs = ({
  tabs,
  written,
  open,
  onOpen,
}: {
  tabs: ReadonlyArray<FileName>
  written: ReadonlyMap<FileName, string | null>
  open: FileName
  onOpen: (name: FileName) => void
}) => (
  <div className="tabs" role="tablist" aria-label="Task files">
    {tabs.map((name) => (
      <button
        key={name}
        type="button"
        role="tab"
        className={`tab${written.has(name) ? "" : " missing"}`}
        aria-selected={name === open}
        onClick={() => onOpen(name)}
      >
        {name}
        <span className={`st st-${written.get(name) ?? "none"}`} aria-hidden="true" />
      </button>
    ))}
  </div>
)

/** The open file: its name and status, then its Markdown, polled while it is open. */
const OpenFile = ({ taskId, name, isWritten, status }: { taskId: string; name: FileName; isWritten: boolean; status: string | null }) => {
  const loadText = useCallback(() => (isWritten ? fetchTaskFileText(taskId, name) : Promise.resolve(null)), [taskId, name, isWritten])
  const { value: text } = usePolling(loadText, null)
  return (
    <>
      <p className="small">
        {name}.md · {isWritten ? (status ?? "written") : "not written yet"}
      </p>
      {text !== null && <TaskMarkdown text={text} taskId={taskId} />}
    </>
  )
}

/** The verify screenshots, each opening full size in a new tab. */
const EvidenceGallery = ({ taskId, paths }: { taskId: string; paths: ReadonlyArray<string> }) => {
  if (paths.length === 0) return null
  return (
    <div className="shots">
      {paths.map((path) => (
        <figure key={path}>
          <a href={evidenceUrl(taskId, path)} target="_blank" rel="noopener noreferrer">
            <img loading="lazy" alt={path} src={evidenceUrl(taskId, path)} />
          </a>
          <figcaption>{path}</figcaption>
        </figure>
      ))}
    </div>
  )
}
