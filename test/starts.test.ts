// The start stream, GET /starts: the GitHub backlog tasks to start, those waiting at connect, then each new one.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { startServer } from "./server.ts"

const TOKEN = "s3cret-token"
let dir: string, server: Subprocess, main: number, trig: number

const issue = (n: number) => ({
  repo: "acme/app",
  issue: { url: `https://github.com/acme/app/issues/${n}`, number: n, title: `Fix thing ${n}` },
  request: "please fix",
})
const fromGithub = async (n: number) =>
  (await (
    await fetch(`http://127.0.0.1:${trig}/github/issues`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(issue(n)),
    })
  ).json()) as { id: string }
const api = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${main}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

/** Reads the stream's events: `next()` is the next id, or undefined when none comes within `ms`. */
const openStream = async () => {
  const res = await fetch(`http://127.0.0.1:${main}/starts`)
  const reader = (res.body as ReadableStream<Uint8Array<ArrayBuffer>>).getReader()
  const text = new TextDecoder()
  let buffer = ""
  let pending: ReturnType<typeof reader.read> | undefined // a read that timed out is kept, not lost
  const next = async (ms: number): Promise<string | undefined> => {
    const deadline = Date.now() + ms
    for (;;) {
      const at = buffer.indexOf("\n\n")
      if (at >= 0) {
        const event = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        if (event.startsWith("data: ")) return event.slice(6)
        continue
      }
      pending ??= reader.read()
      const chunk = await Promise.race([pending, Bun.sleep(Math.max(0, deadline - Date.now())).then(() => undefined)])
      if (chunk === undefined || chunk.done) return undefined
      pending = undefined
      buffer += text.decode(chunk.value)
    }
  }
  return { res, next, close: () => reader.cancel() }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-starts-"))
  main = 20000 + Math.floor(Math.random() * 10000)
  trig = main + 1
  server = await startServer(main, { ORQ_DATA: join(dir, "server"), ORQ_TRIGGER_TOKEN: TOKEN }, undefined, undefined, trig)
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("start stream", () => {
  test("a watcher gets the waiting GitHub tasks at connect, then each new one, each once", async () => {
    const waiting = await fromGithub(1)
    const started = await fromGithub(2)
    await api(`/tasks/${started.id}/start`, { repo: "acme/app", worktree: join(dir, "wt") })
    const blocked = await fromGithub(3)
    await api(`/tasks/${blocked.id}/state`, { step: "plan", status: "BLOCKED", note: "stuck" })
    await api("/tasks", { repo: "acme/app", title: "by hand", slug: "by-hand", base: "main" })

    const stream = await openStream()
    expect(stream.res.headers.get("content-type")).toContain("text/event-stream")
    expect(await stream.next(10000)).toBe(waiting.id)
    expect(await stream.next(500)).toBeUndefined()

    const fresh = await fromGithub(4)
    expect(await stream.next(10000)).toBe(fresh.id)
    await fromGithub(4)
    expect(await stream.next(500)).toBeUndefined()
    await stream.close()
  })
})
