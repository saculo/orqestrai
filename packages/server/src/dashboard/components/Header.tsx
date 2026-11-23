import { ALL_PROJECTS } from "../board.ts"
import type { Polled } from "../hooks.ts"
import { timeAgo } from "../tasks.ts"
import { BoardIcon } from "./icons.tsx"

type Props = {
  /** repo path → its name in the filter */
  projects: ReadonlyMap<string, string>
  selectedProject: string
  onSelectProject: (repo: string) => void
  board: Polled<unknown>
  now: number
}

/** The top bar: the logo, the project filter and whether the board is live. */
export const Header = ({ projects, selectedProject, onSelectProject, board, now }: Props) => (
  <header className="top">
    <div className="logo">
      <BoardIcon />
      orq
    </div>
    <ProjectFilter projects={projects} selected={selectedProject} onSelect={onSelectProject} />
    <LiveIndicator board={board} now={now} />
  </header>
)

const ProjectFilter = ({
  projects,
  selected,
  onSelect,
}: {
  projects: ReadonlyMap<string, string>
  selected: string
  onSelect: (repo: string) => void
}) => {
  const choices: ReadonlyArray<[string, string]> = [[ALL_PROJECTS, "All projects"], ...projects]
  return (
    <nav className="pills" aria-label="Projects">
      {choices.map(([repo, label]) => (
        <button key={repo} type="button" className="pill" aria-pressed={repo === selected} onClick={() => onSelect(repo)}>
          {label}
        </button>
      ))}
    </nav>
  )
}

const LiveIndicator = ({ board, now }: { board: Polled<unknown>; now: number }) => {
  const text = board.failed
    ? "orq serve unreachable"
    : board.updatedAt === null
      ? "loading"
      : `live · updated ${timeAgo(new Date(board.updatedAt).toISOString(), now)} ago`
  return (
    <div className={`live${board.failed ? " down" : ""}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  )
}
