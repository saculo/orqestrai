// Tasks that are not started (a backlog): added through the state's HTTP API, with no worktree
// until they start. The CLI and the dashboard have to cope with them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { startServer } from "./server.ts"

let dir: string, socket: string, server: Subprocess

const api = (method: string, path: string, body?: unknown) =>
  fetch(`http://orq${path}`, {
    method,
    unix: socket,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  } as RequestInit)

const orq = (args: string[], extra: Record<string, string> = {}) => {
  const env = { ...process.env, ORQ_DATA: join(dir, "home"), ORQ_SERVER: socket, ORQ_HC: "orq-test-no-hc", ...extra }
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const aBacklogTask = async (title = "Add search") => {
  const r = await api("POST", "/tasks", { repo: "/p/proj", title, slug: "add-search", base: "main" })
  return (await r.json()) as { id: string; worktree: string | null; status: string; step: string }
}

const anIssue = (url = "https://github.com/saculo/meal-prep/issues/7") => ({
  repo: "saculo/meal-prep",
  url,
  title: "Plan the week",
  request: "Plan meals for the week",
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-backlog-"))
  socket = join(dir, "orq.sock")
  mkdirSync(join(dir, "server"))
  server = await startServer(socket, { ORQ_DATA: join(dir, "server") })
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("a task that is not started", () => {
  test("B8: orq resume fails and names orq start", async () => {
    const task = await aBacklogTask()
    expect(task.worktree).toBeNull()
    expect(task.status).toBe("TODO")

    const r = orq(["resume", task.id])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${task.id} is not started; run orq start ${task.id}`)
  })

  test("start records the checkout once; the second start fails", async () => {
    const task = await aBacklogTask()

    const first = await api("POST", `/tasks/${task.id}/start`, { repo: "/p/proj", worktree: "/w/one" })
    expect(first.ok).toBe(true)
    const started = (await (await api("GET", `/tasks/${task.id}`)).json()) as { worktree: string; repo: string }
    expect(started.worktree).toBe("/w/one")

    const second = await api("POST", `/tasks/${task.id}/start`, { repo: "/p/proj", worktree: "/w/two" })
    expect(second.status).toBe(422)
    expect(((await second.json()) as { message: string }).message).toContain(`${task.id} is already started; orq resume ${task.id}`)
    const still = (await (await api("GET", `/tasks/${task.id}`)).json()) as { worktree: string }
    expect(still.worktree).toBe("/w/one")
  })

  test("the same issue twice, even together, is one github task with its request", async () => {
    const add = async () => (await (await api("POST", "/issues", anIssue())).json()) as { id: string; added: boolean }
    const results = await Promise.all([add(), add(), add()])
    const again = await add()

    expect(new Set([...results, again].map((r) => r.id)).size).toBe(1)
    expect(results.filter((r) => r.added)).toHaveLength(1)
    expect(again.added).toBe(false)

    const id = again.id
    expect(((await (await api("GET", "/tasks")).json()) as unknown[]).length).toBe(1)
    const task = (await (await api("GET", `/tasks/${id}`)).json()) as { source: string; repo: string; worktree: null; status: string }
    expect(task).toMatchObject({ source: "github", repo: "saculo/meal-prep", worktree: null, status: "TODO" })
    const links = (await (await api("GET", `/tasks/${id}/links`)).json()) as unknown[]
    expect(links).toEqual([{ kind: "gh-issue", ref: anIssue().url, role: "origin" }])
    const file = (await (await api("GET", `/tasks/${id}/copy?path=REQUEST.md`)).json()) as string
    expect(Buffer.from(file, "base64").toString()).toContain(`id: ${id}\ncreated: `)
    expect(Buffer.from(file, "base64").toString()).toEndWith("---\n\nPlan meals for the week\n")
  })

  test("B6: a GitHub task whose repo has no checkout is BLOCKED naming [github] repos; once added, start works", async () => {
    const checkout = join(dir, "meal-prep")
    mkdirSync(checkout)
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["commit", "-q", "--allow-empty", "-m", "init"],
    ])
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: checkout })
    const { id } = (await (await api("POST", "/issues", anIssue())).json()) as { id: string }

    const failed = orq(["start", id])
    expect(failed.code).not.toBe(0)
    const shown = orq(["show", id]).out
    expect(shown).toMatch(/status = BLOCKED/)
    expect(shown).toContain("saculo/meal-prep")
    expect(shown).toContain("[github] repos")

    const started = orq(["start", id], { ORQ_GITHUB_REPOS: `saculo/meal-prep=${checkout}` })
    expect(started.code).toBe(0)
    const task = (await (await api("GET", `/tasks/${id}`)).json()) as { worktree: string; repo: string }
    expect(task.repo).toBe(checkout)
    expect(readFileSync(join(task.worktree, ".orqestrai", "tasks", id, "REQUEST.md"), "utf8")).toContain("Plan meals for the week")
  })
  test("orq clean of a dropped task that never started removes nothing and keeps the row", async () => {
    const github = ((await (await api("POST", "/issues", anIssue())).json()) as { id: string }).id
    const local = (await aBacklogTask()).id
    const checkout = join(dir, "proj")
    mkdirSync(checkout)
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: checkout })
    const inRepo = (await (await api("POST", "/tasks", { repo: checkout, title: "Other", slug: "other", base: "main" })).json()) as {
      id: string
    }
    for (const id of [github, local, inRepo.id]) {
      expect(orq(["set-state", id, "triage", "DROPPED"]).code).toBe(0)
      const r = orq(["clean", id])
      expect(r.err).toBe("")
      expect(r.code).toBe(0)
      expect(r.out).not.toMatch(/removed/)
      expect(orq(["ls"]).out).toContain(id)
    }
  })
})
