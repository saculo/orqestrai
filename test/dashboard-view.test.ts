// The dashboard's logic, without a browser: what needs you, what runs, the columns, the project
// filter, the task's links and the panel's tabs (src/dashboard/{board,tasks,taskFiles}.ts).
import { describe, expect, test } from "bun:test"
import { ALL_PROJECTS, buildBoard, FINISHED_TASKS_SHOWN_FOR_MS } from "../src/dashboard/board.ts"
import type { BoardTask } from "../src/dashboard/serverApi.ts"
import { fileTabs, latestFile, taskLinkTarget, writtenFiles } from "../src/dashboard/taskFiles.ts"
import { projectLabels, pullRequestOf, slackThreadUrl, timeAgo } from "../src/dashboard/tasks.ts"

const NOW = Date.parse("2026-11-19T12:00:00Z")
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

const task = (fields: Partial<BoardTask> & Pick<BoardTask, "id">): BoardTask => ({
  repo: "/home/me/Projects/meal-prep",
  title: fields.id,
  branch: `orq/${fields.id}`,
  worktree: `/w/${fields.id}`,
  step: "triage",
  status: "TODO",
  type: null,
  created_at: minutesAgo(60),
  updated_at: minutesAgo(10),
  note: "",
  message: null,
  links: [],
  ...fields,
})

describe("the board", () => {
  const tasks = [
    task({ id: "T-1", status: "WAITING FOR ME", step: "plan", updated_at: minutesAgo(5) }),
    task({ id: "T-2", status: "BLOCKED", step: "impl", updated_at: minutesAgo(1) }),
    task({ id: "T-3", status: "WAITING FOR ME", step: "triage", updated_at: minutesAgo(30) }),
    task({ id: "T-4", status: "IN PROGRESS", step: "impl" }),
    task({ id: "T-5", status: "MERGED", step: "ship", updated_at: minutesAgo(60) }),
    task({ id: "T-6", status: "DROPPED", step: "triage", updated_at: new Date(NOW - FINISHED_TASKS_SHOWN_FOR_MS - 1).toISOString() }),
    task({ id: "T-7", status: "TODO", repo: "/home/me/Projects/orqestrai" }),
  ]
  const board = buildBoard(tasks, ALL_PROJECTS, NOW)
  const ids = (list: ReadonlyArray<BoardTask>) => list.map((t) => t.id)

  test("needs you: blocked first, then the longest waiting", () => {
    expect(ids(board.needsYou)).toEqual(["T-2", "T-3", "T-1"])
  })

  test("running: neither waiting for you nor finished", () => {
    expect(ids(board.running)).toEqual(["T-4", "T-7"])
  })

  test("one column per step, then done; a task finished long ago has left the board", () => {
    expect(board.columns.map((c) => [c.name, ids(c.tasks)])).toEqual([
      ["triage", ["T-3", "T-7"]],
      ["plan", ["T-1"]],
      ["impl", ["T-2", "T-4"]],
      ["verify", []],
      ["learn", []],
      ["ship", []],
      ["done", ["T-5"]],
    ])
  })

  test("one project: only its repo's tasks", () => {
    const one = buildBoard(tasks, "/home/me/Projects/orqestrai", NOW)
    expect(one.columns.flatMap((c) => ids(c.tasks))).toEqual(["T-7"])
  })
})

describe("a task's facts", () => {
  test("project names: the folder, or with its parent when two repos share it", () => {
    const labels = projectLabels([
      task({ id: "T-1", repo: "/work/client/api" }),
      task({ id: "T-2", repo: "/work/server/api" }),
      task({ id: "T-3", repo: "/work/meal-prep" }),
    ])
    expect([...labels]).toEqual([
      ["/work/client/api", "client/api"],
      ["/work/server/api", "server/api"],
      ["/work/meal-prep", "meal-prep"],
    ])
  })

  test("time ago, in the largest whole unit", () => {
    expect([0.5, 5, 180, 3 * 1440].map((m) => timeAgo(minutesAgo(m), NOW))).toEqual(["30s", "5m", "3h", "3d"])
  })

  test("the pull request and the Slack thread, from the task's links", () => {
    const linked = task({
      id: "T-1",
      links: [
        { kind: "gh-pr", ref: "https://github.com/me/app/pull/42", role: "related" },
        { kind: "slack-thread", ref: "C123/1700000000.000100", role: "origin" },
      ],
    })
    expect(pullRequestOf(linked)).toEqual({ url: "https://github.com/me/app/pull/42", label: "#42" })
    expect(slackThreadUrl(linked)).toBe("https://slack.com/archives/C123/p1700000000000100")
    expect([pullRequestOf(task({ id: "T-2" })), slackThreadUrl(task({ id: "T-2" }))]).toEqual([null, null])
  })
})

describe("the panel's files", () => {
  const written = writtenFiles({
    files: [
      { name: "REQUEST", status: null },
      { name: "RESEARCH", status: null },
      { name: "SPEC", status: "approved" },
    ],
    evidence: [],
  })

  test("tabs: the written files and the steps ahead, in step order; the latest opens first", () => {
    expect(fileTabs(written)).toEqual(["REQUEST", "RESEARCH", "BRIEF", "SPEC", "VERIFY", "PR"])
    expect(latestFile(written)).toBe("SPEC")
    expect(latestFile(new Map())).toBe("REQUEST")
  })

  test("links in a task's Markdown: its evidence and files go to its routes, nothing else", () => {
    expect(taskLinkTarget("T-1", "evidence/V1/V1 list.png")).toBe("tasks/T-1/evidence/V1/V1%20list.png")
    expect(taskLinkTarget("T-1", "./SPEC.md")).toBe("tasks/T-1/files/SPEC")
    for (const url of ["https://example.com/a.png", "/etc/passwd", "#ac1", "evidence/../../x.png", "NOTES.md", "javascript:alert(1)"])
      expect([url, taskLinkTarget("T-1", url)]).toEqual([url, null])
  })
})
