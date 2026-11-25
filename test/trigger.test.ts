// The trigger endpoint on orq-server --trigger-port: one task per issue, the token, one route.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ_SERVER } from "./orq.ts"
import { startServer } from "./server.ts"

const TOKEN = "s3cret-token"
let dir: string, server: Subprocess, main: number, trig: number

const issue = (n: number) => ({
  repo: "acme/app",
  issue: { url: `https://github.com/acme/app/issues/${n}`, number: n, title: `Fix thing ${n}` },
  request: "please fix",
})
const post = (body: unknown, token?: string) =>
  fetch(`http://127.0.0.1:${trig}/github/issues`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
const tasks = async () => (await (await fetch(`http://127.0.0.1:${main}/tasks`)).json()) as Array<Record<string, unknown>>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-trigger-"))
  main = 20000 + Math.floor(Math.random() * 10000)
  trig = main + 1
  server = await startServer(main, { ORQ_DATA: join(dir, "server"), ORQ_TRIGGER_TOKEN: TOKEN }, undefined, undefined, trig)
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("trigger endpoint", () => {
  test("the same issue twice, also at once, is one task from github", async () => {
    const [a, b] = await Promise.all([post(issue(7), TOKEN), post(issue(7), TOKEN)])
    const c = await post(issue(7), TOKEN)
    const ids = await Promise.all([a, b, c].map(async (r) => ((await r.json()) as { id: string }).id))
    expect(new Set(ids).size).toBe(1)
    const all = await tasks()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: ids[0], source: "github", repo: "acme/app" })
    const links = await (await fetch(`http://127.0.0.1:${main}/tasks/${ids[0]}/links`)).json()
    expect(links).toContainEqual({ kind: "gh-issue", ref: issue(7).issue.url, role: "origin" })
  })

  test("no token or a wrong token is 401 and adds nothing", async () => {
    expect((await post(issue(1))).status).toBe(401)
    expect((await post(issue(1), "wrong")).status).toBe(401)
    expect((await post(issue(1), "")).status).toBe(401)
    expect(await tasks()).toHaveLength(0)
  })

  test("a bad body is 400", async () => {
    expect((await post({ repo: "x" }, TOKEN)).status).toBe(400)
    expect(await tasks()).toHaveLength(0)
  })

  test("a repo that is not a GitHub name, or an issue url of another repo, is 400 and adds nothing", async () => {
    const ok = issue(5)
    for (const repo of ["/etc", "/home/x/proj", "../x", ".a/b", "a/.b", "a/b/c", "a", "a b/c"])
      expect((await post({ ...ok, repo }, TOKEN)).status).toBe(400)
    for (const url of [
      "https://github.com/other/app/issues/5",
      "https://evil.example/acme/app/issues/5",
      "https://github.com/acme/app/pull/5",
    ])
      expect((await post({ ...ok, issue: { ...ok.issue, url } }, TOKEN)).status).toBe(400)
    expect(await tasks()).toHaveLength(0)
  })

  test("only the trigger route answers on the trigger port, and it is not on the main port", async () => {
    for (const path of ["/tasks", "/board", "/"]) expect((await fetch(`http://127.0.0.1:${trig}${path}`)).status).toBe(404)
    expect((await post(issue(2), TOKEN)).status).toBe(200)
    const onMain = await fetch(`http://127.0.0.1:${main}/github/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(issue(3)),
    })
    expect(onMain.status).toBe(404)
    expect(await tasks()).toHaveLength(1)
  })

  test("--trigger-port without ORQ_TRIGGER_TOKEN does not start", async () => {
    for (const token of [undefined, ""]) {
      const env: Record<string, string | undefined> = { ...process.env, ORQ_DATA: join(dir, "x"), ORQ_TRIGGER_TOKEN: token }
      const p = Bun.spawnSync([...ORQ_SERVER, "--port", String(main + 2), "--trigger-port", String(main + 3)], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(p.exitCode).not.toBe(0)
      expect(p.stderr.toString()).toContain("needs ORQ_TRIGGER_TOKEN")
    }
  })
})
