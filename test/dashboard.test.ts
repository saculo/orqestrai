// The dashboard, as a browser gets it from `orq serve`: the page and its bundle, the board, a
// task's files and evidence. The tasks are made by orq through the server, as on a real machine;
// the server keeps its state elsewhere (ORQ_DATA=server) than the worktrees (home), as on another
// machine, so the task files reach it only as the copies orq sends.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { startServer } from "./server.ts"

let dir: string, repo: string, socket: string, server: Subprocess, url: string, files: string

const run = (args: string[]) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_SERVER: socket,
    ORQ_ZELLIJ_SESSION: "orq-test-none",
    ORQ_BRIDGE: join(dir, "no-bridge.sock"),
  }
  delete env.ZELLIJ
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() }
}
const orq = (args: string[]) => {
  const p = run(args)
  if (p.code !== 0) throw new Error(`orq ${args.join(" ")}: ${p.stderr}`)
  return p.stdout
}

const get = (path: string) => fetch(`${url}${path}`)
const json = async <T = unknown>(path: string) => (await get(path)).json() as Promise<T>

type BoardTask = { id: string; status: string; note: string; message: string | null; links: unknown[] }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-dashboard-"))
  repo = join(dir, "proj")
  socket = join(dir, "orq.sock")
  mkdirSync(repo)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
  const port = 20_000 + Math.floor(Math.random() * 20_000)
  // one server, on the socket (the sessions) and a TCP port (the browser) at once
  server = await startServer(socket, { ORQ_DATA: join(dir, "server") }, port)
  url = `http://127.0.0.1:${port}`

  orq(["new", "Weekly shopping list"])
  orq(["new", "Dark mode"])
  orq(["state", "T-0001", "plan", "IN PROGRESS"])

  files = join(dir, "home", "worktrees", "proj", "T-0001-weekly-shopping-list", ".orqestrai", "tasks", "T-0001")
  writeFileSync(join(files, "SPEC.md"), "---\nid: T-0001\nstatus: draft\n---\n\n# Spec\n")
  writeFileSync(join(files, "NOTES.md"), "not a task file")
  mkdirSync(join(files, "evidence", "V1"), { recursive: true })
  writeFileSync(join(files, "evidence", "V1", "V1-list.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(files, "evidence", "V1", "trace.md"), "# trace")
  // orq ask sends the files, as orq state does
  orq(["ask", "T-0001", "**SPEC.md ready: 4 ACs**\n- AC1 sums\n\n**Q9 - Approve SPEC.md?**\n- Recommended: yes"])
  orq(["link", "T-0001", "slack-thread", "C1/100.1", "origin"])
})

afterAll(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("the dashboard", () => {
  test("/ is the page, and its bundled script and styles load (from any working directory)", async () => {
    const page = await (await get("/")).text()
    expect(page).toContain('<div id="root"></div>')
    // "/chunk-….js" from the source, "./chunk-….js" from the compiled binary
    const assets = [...page.matchAll(/(?:src|href)="\.?(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1] ?? "")
    expect(assets.length).toBe(2)
    for (const asset of assets) {
      const r = await get(asset)
      expect(r.status).toBe(200)
      expect((await r.text()).length).toBeGreaterThan(1000)
    }
  })

  test("the board: each task with its last note, the message it waits on and its links", async () => {
    const board = await json<BoardTask[]>("/board")
    const [waiting, todo] = [board.find((t) => t.id === "T-0001"), board.find((t) => t.id === "T-0002")]
    expect(waiting).toMatchObject({ status: "WAITING FOR ME", note: "SPEC.md ready: 4 ACs" })
    expect(waiting?.message).toBe("**SPEC.md ready: 4 ACs**\n- AC1 sums\n\n**Q9 - Approve SPEC.md?**\n- Recommended: yes")
    expect(waiting?.links).toEqual([{ kind: "slack-thread", ref: "C1/100.1", role: "origin" }])
    expect(todo).toMatchObject({ status: "TODO", message: null })
  })

  test("a message is shown only while the task waits on it", async () => {
    orq(["new", "Portions"])
    orq(["ask", "T-0003", "**Which unit?**"])
    orq(["state", "T-0003", "triage", "IN PROGRESS"])
    const task = (await json<BoardTask[]>("/board")).find((t) => t.id === "T-0003")
    expect(task).toMatchObject({ status: "IN PROGRESS", message: null })
  })

  test("a task's files, with the status in their frontmatter, and its evidence images", async () => {
    expect(await json("/tasks/T-0001/files")).toEqual({
      files: [
        { name: "REQUEST", status: null },
        { name: "SPEC", status: "draft" },
      ],
      evidence: ["V1/V1-list.png"],
    })
    expect(await (await get("/tasks/T-0001/files/SPEC")).text()).toContain("# Spec")
    const image = await get("/tasks/T-0001/evidence/V1/V1-list.png")
    expect(image.status).toBe(200)
    expect(image.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  test("only the task files and the evidence images: nothing else on the machine", async () => {
    for (const path of [
      "/tasks/T-0001/files/..%2F..%2F..%2Fstate",
      "/tasks/T-0001/files/NOTES",
      "/tasks/T-0001/evidence/V1/trace.md",
      "/tasks/T-0001/evidence/..%2F..%2FREQUEST.md",
      "/tasks/T-0001/evidence/%2E%2E/%2E%2E/%2E%2E/%2E%2E/%2E%2E/%2E%2E/etc/passwd",
      "/tasks/T-0099/files",
    ])
      expect([path, (await get(path)).status]).toEqual([path, 404])
  })

  test("orq state sends what changed, and the server forgets what is gone", async () => {
    writeFileSync(join(files, "SPEC.md"), "---\nid: T-0001\nstatus: approved\n---\n\n# Spec, approved\n")
    rmSync(join(files, "evidence", "V1", "V1-list.png"))
    writeFileSync(join(files, "evidence", "V1", "V1-total.webp"), new Uint8Array([1, 2, 3]))
    orq(["state", "T-0001", "impl", "IN PROGRESS"])
    expect(await json("/tasks/T-0001/files")).toEqual({
      files: [
        { name: "REQUEST", status: null },
        { name: "SPEC", status: "approved" },
      ],
      evidence: ["V1/V1-total.webp"],
    })
    expect(await (await get("/tasks/T-0001/files/SPEC")).text()).toContain("# Spec, approved")
    expect((await get("/tasks/T-0001/evidence/V1/V1-list.png")).status).toBe(404)
  })

  test("the server keeps only task files and evidence images, whoever sends them", async () => {
    for (const path of ["../state.db", "NOTES.md", "evidence/trace.md", "evidence/../SPEC.png", "/etc/x.png", "evidence/x.constructor"]) {
      const r = await fetch(`${url}/tasks/T-0001/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ put: [{ path, content: "AAAA" }], keep: [] }),
      })
      expect([path, r.status]).toEqual([path, 422])
    }
  })

  test("symbolic links are not followed: a link to a file elsewhere is never sent", async () => {
    const t3 = join(dir, "home", "worktrees", "proj", "T-0003-portions", ".orqestrai", "tasks", "T-0003")
    const secret = join(dir, "secret.png")
    writeFileSync(secret, "a private file")
    symlinkSync(secret, join(t3, "LEARN.md"))
    mkdirSync(join(t3, "evidence"))
    symlinkSync(secret, join(t3, "evidence", "shot.png"))
    symlinkSync(dir, join(t3, "evidence", "all"))
    orq(["state", "T-0003", "triage", "IN PROGRESS"])
    expect(await json("/tasks/T-0003/files")).toEqual({ files: [{ name: "REQUEST", status: null }], evidence: [] })
  })

  test("a frontmatter with CRLF line ends has its status too", async () => {
    const t3 = join(dir, "home", "worktrees", "proj", "T-0003-portions", ".orqestrai", "tasks", "T-0003")
    writeFileSync(join(t3, "BRIEF.md"), "---\r\nid: T-0003\r\nstatus: approved\r\n---\r\n\r\n# Brief\r\n")
    orq(["state", "T-0003", "plan", "IN PROGRESS"])
    const { files } = await json<{ files: unknown[] }>("/tasks/T-0003/files")
    expect(files).toContainEqual({ name: "BRIEF", status: "approved" })
  })

  test("a file orq cannot read: a warning, and the state is recorded all the same", async () => {
    const brief = join(dir, "home", "worktrees", "proj", "T-0003-portions", ".orqestrai", "tasks", "T-0003", "BRIEF.md")
    chmodSync(brief, 0o000)
    const p = run(["state", "T-0003", "impl", "IN PROGRESS"])
    chmodSync(brief, 0o644)
    expect(p.code).toBe(0)
    expect(p.stderr).toContain("warning: the task files did not reach the dashboard")
    expect((await json<BoardTask[]>("/board")).find((t) => t.id === "T-0003")).toMatchObject({ step: "impl" })
  })

  test("a task whose worktree is gone: the server still has its files", async () => {
    rmSync(join(dir, "home", "worktrees", "proj", "T-0002-dark-mode"), { recursive: true, force: true })
    orq(["state", "T-0002", "triage", "IN PROGRESS"])
    expect(await json("/tasks/T-0002/files")).toEqual({ files: [{ name: "REQUEST", status: null }], evidence: [] })
  })

  test("the message stays on the board however many events come after it", async () => {
    orq(["new", "Many links"])
    orq(["ask", "T-0004", "**Which store?**\n- Recommended: the one nearby"])
    for (let n = 0; n < 31; n++) orq(["link", "T-0004", "note", `ref-${n}`])
    const task = (await json<BoardTask[]>("/board")).find((t) => t.id === "T-0004")
    expect(task).toMatchObject({ note: "Which store?", message: expect.stringContaining("Recommended: the one nearby") })
  }, 60_000)

  test("orq show leaves the whole messages out; the note is enough there", () => {
    const shown = orq(["show", "T-0001"])
    expect(shown).toContain("plan: WAITING FOR ME")
    expect(shown).not.toContain("Recommended")
  })

  test("a relative ORQ_DATA is the server's own working directory's, though it serves the page from elsewhere", async () => {
    const other = await startServer(join(dir, "other.sock"), { ORQ_DATA: "relative-data" }, undefined, dir)
    other.kill()
    expect(existsSync(join(dir, "relative-data", "state.db"))).toBe(true)
  })
})
