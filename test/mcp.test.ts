// orq serve: the MCP tools over HTTP and stdio, as Claude Code calls them.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Subprocess } from "bun"
import { freshDatabase, startPostgres } from "./pg.ts"

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts")
let dir: string, repo: string, pg: Record<string, string>

const envFor = (extra: Record<string, string> = {}) => {
  const env = { ...process.env, ORQ_HOME: join(dir, "home"), ...pg, ORQ_ZELLIJ_SESSION: "orq-test-none", ...extra } as Record<
    string,
    string | undefined
  >
  delete env.ZELLIJ
  return env
}
const orq = (args: string[]) =>
  Bun.spawnSync([process.execPath, CLI, ...args], { cwd: repo, env: envFor(), stdout: "pipe", stderr: "pipe" })

beforeAll(startPostgres, 120_000)

beforeEach(async () => {
  pg = await freshDatabase()
  dir = mkdtempSync(join(tmpdir(), "orq-mcp-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
  orq(["new", "one"])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A minimal MCP client over Streamable HTTP: initialize once, then call tools. */
const httpClient = async (url: string) => {
  let session: string | null = null
  let next = 1
  const post = async (method: string, params: unknown, notify = false) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: next++, method, params }),
    })
    session ??= res.headers.get("mcp-session-id")
    if (notify) return undefined
    const text = await res.text()
    const json = text.startsWith("{")
      ? text
      : (text
          .split("\n")
          .find((l) => l.startsWith("data: "))
          ?.slice(6) ?? text)
    return JSON.parse(json)
  }
  await post("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } })
  await post("notifications/initialized", {}, true)
  return {
    list: async () => (await post("tools/list", {})).result.tools as Array<{ name: string }>,
    call: async (name: string, args: unknown) => (await post("tools/call", { name, arguments: args })).result,
  }
}

describe("orq serve over HTTP", () => {
  let server: Subprocess
  const port = 7400 + Math.floor(Math.random() * 500)
  const url = `http://127.0.0.1:${port}/mcp`

  beforeEach(async () => {
    server = Bun.spawn([process.execPath, CLI, "serve", "--port", String(port)], {
      cwd: repo,
      env: envFor(),
      stdout: "ignore",
      stderr: "pipe",
    })
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(url, { method: "GET" }).then(
          () => true,
          () => false,
        )
      )
        return
      await Bun.sleep(100)
    }
    throw new Error("orq serve did not start")
  })
  afterEach(() => server.kill())
  afterAll(() => server?.kill())

  test("lists the six tools", async () => {
    const c = await httpClient(url)
    expect((await c.list()).map((t) => t.name).sort()).toEqual(
      ["orq_link", "orq_show", "orq_slot_free", "orq_slot_keep", "orq_slot_take", "orq_state"].sort(),
    )
  })

  test("orq_state records the step and status that orq_show then reads", async () => {
    const c = await httpClient(url)
    expect((await c.call("orq_state", { id: "T-0001", step: "verify", status: "IN PROGRESS", note: "round 1" })).isError).toBe(false)
    const shown = (await c.call("orq_show", { id: "T-0001" })).structuredContent
    expect(shown.task).toMatchObject({ id: "T-0001", step: "verify", status: "IN PROGRESS" })
    expect(shown.events[0]).toMatchObject({ kind: "verify: IN PROGRESS", detail: "round 1" })
    expect(typeof shown.task.created_at).toBe("string")
  })

  test("orq_link adds a link that orq show prints", async () => {
    const c = await httpClient(url)
    await c.call("orq_link", { id: "T-0001", kind: "gh-pr", ref: "https://github.com/o/r/pull/1" })
    expect(orq(["show", "T-0001"]).stdout.toString()).toContain("link gh-pr https://github.com/o/r/pull/1 (related)")
  })

  test("a step that does not exist is refused before it reaches the database", async () => {
    const c = await httpClient(url)
    const r = await c.call("orq_state", { id: "T-0001", step: "deploy", status: "TODO" })
    expect(r?.isError ?? true).toBe(true)
  })

  test("an unknown task is an error with orq's message", async () => {
    const c = await httpClient(url)
    const r = await c.call("orq_show", { id: "T-0099" })
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.content)).toContain("no task T-0099")
  })

  test("slots: take, keep, free; free hands back the stop command", async () => {
    const c = await httpClient(url)
    expect((await c.call("orq_slot_take", { id: "T-0001" })).structuredContent).toMatchObject({
      slot: 1,
      port_base: 4100,
      project: "orq-t-0001",
      expired: [],
    })
    await c.call("orq_slot_keep", { id: "T-0001", stop: "docker compose down", port: 4100 })
    expect((await c.call("orq_slot_free", { id: "T-0001" })).structuredContent).toMatchObject({ n: 1, stop: "docker compose down" })
  })
})

describe("orq serve --stdio", () => {
  test("answers a tool call on stdout", async () => {
    const p = Bun.spawn([process.execPath, CLI, "serve", "--stdio"], {
      cwd: repo,
      env: envFor(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const send = (m: object) => p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`)
    send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    })
    send({ method: "notifications/initialized", params: {} })
    send({ id: 2, method: "tools/call", params: { name: "orq_show", arguments: { id: "T-0001" } } })
    await p.stdin.flush()
    const reader = p.stdout.getReader()
    let out = ""
    while (!out.includes('"id":2')) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    p.kill()
    const reply = out
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.id === 2)
    expect(reply.result.structuredContent.task.id).toBe("T-0001")
  }, 30_000)
})
