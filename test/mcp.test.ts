// orq mcp: the tools over stdio, as Claude Code starts them. Run here as on the VPS: through
// `orq serve`, with ORQ_SERVER and no PG* variable.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { freshDatabase, startPostgres } from "./pg.ts"
import { startServer, withoutPg } from "./server.ts"

let dir: string, repo: string, socket: string, server: Subprocess

const env = () => {
  const e: Record<string, string | undefined> = {
    ...withoutPg(),
    ORQ_HOME: join(dir, "home"),
    ORQ_SERVER: socket,
    ORQ_ZELLIJ_SESSION: "orq-test-none",
  }
  delete e.ZELLIJ
  return e
}

/** A minimal MCP client over stdio: initialize, then one request at a time. */
const connect = async () => {
  const p = Bun.spawn([...ORQ, "mcp"], { cwd: repo, env: env(), stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const reader = p.stdout.getReader()
  let buffered = ""
  let next = 1
  const request = async (method: string, params: unknown) => {
    const id = next++
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    await p.stdin.flush()
    for (;;) {
      const lines = buffered.split("\n")
      buffered = lines.pop() ?? ""
      for (const line of lines.filter(Boolean)) {
        const msg = JSON.parse(line)
        if (msg.id === id) return msg
      }
      const { value, done } = await reader.read()
      if (done) throw new Error(`orq mcp exited: ${await new Response(p.stderr).text()}`)
      buffered += new TextDecoder().decode(value)
    }
  }
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } })
  p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`)
  return {
    tools: async () => ((await request("tools/list", {})).result.tools as Array<{ name: string }>).map((t) => t.name).sort(),
    call: async (name: string, args: unknown) => await request("tools/call", { name, arguments: args }),
    close: () => p.kill(),
  }
}

beforeAll(startPostgres, 120_000)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-mcp-"))
  repo = join(dir, "proj")
  socket = join(dir, "orq.sock")
  mkdirSync(repo)
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
  server = await startServer(socket, await freshDatabase())
  Bun.spawnSync([...ORQ, "new", "one"], { cwd: repo, env: env() })
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("orq mcp", () => {
  test("lists the six tools", async () => {
    const c = await connect()
    expect(await c.tools()).toEqual(["orq_link", "orq_show", "orq_slot_free", "orq_slot_keep", "orq_slot_take", "orq_state"])
    c.close()
  }, 30_000)

  test("orq_state records the step and status that orq_show then reads", async () => {
    const c = await connect()
    expect((await c.call("orq_state", { id: "T-0001", step: "verify", status: "IN PROGRESS", note: "round 1" })).result.isError).toBe(false)
    const shown = (await c.call("orq_show", { id: "T-0001" })).result.structuredContent
    expect(shown.task).toMatchObject({ id: "T-0001", step: "verify", status: "IN PROGRESS" })
    expect(shown.events[0]).toMatchObject({ kind: "verify: IN PROGRESS", detail: "round 1" })
    c.close()
  }, 30_000)

  test("a step that does not exist is refused", async () => {
    const c = await connect()
    const r = await c.call("orq_state", { id: "T-0001", step: "deploy", status: "TODO" })
    expect(r.error ?? r.result.isError).toBeTruthy()
    c.close()
  }, 30_000)

  test("an unknown task is an error with orq's message", async () => {
    const c = await connect()
    const r = (await c.call("orq_show", { id: "T-0099" })).result
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.content)).toContain("no task T-0099")
    c.close()
  }, 30_000)

  test("slots: take, keep, free; free hands back the stop command to run", async () => {
    const c = await connect()
    expect((await c.call("orq_slot_take", { id: "T-0001" })).result.structuredContent).toMatchObject({
      slot: 1,
      port_base: 4100,
      project: "orq-t-0001",
      expired: [],
    })
    await c.call("orq_slot_keep", { id: "T-0001", stop: "docker compose down", port: 4100 })
    expect((await c.call("orq_slot_free", { id: "T-0001" })).result.structuredContent).toMatchObject({ n: 1, stop: "docker compose down" })
    c.close()
  }, 30_000)
})
