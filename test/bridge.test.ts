// `orq bridge` against a fake Slack (its Web API and a Socket Mode WebSocket, on localhost) and a
// fake `zellij` on PATH that logs its calls and answers like a session nobody is attached to.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Server, ServerWebSocket, Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { freshDatabase, startPostgres } from "./pg.ts"

const FAKE_ZELLIJ = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_ZELLIJ_DIR/log"
case "$*" in
  "list-sessions"*) echo orq-bridge-test ;;
  *"list-clients"*) echo "CLIENT_ID ZELLIJ_PANE_ID RUNNING_COMMAND" ;;
  *"new-tab"*) echo 1 ;;
  *"new-pane"*) echo terminal_2 ;;
  *"list-panes"*) cat "$FAKE_ZELLIJ_DIR/panes.json" 2>/dev/null || echo "[]" ;;
esac
`

interface Posted {
  channel: string
  text: string
  thread_ts?: string
}

let dir: string, repo: string, pg: Record<string, string>, bridge: Subprocess | undefined
let slack: Server<undefined>, ws: ServerWebSocket<undefined> | undefined
let posts: Posted[], acks: string[], envelopes: number

const env = (extra: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = {
    ...process.env,
    ...pg,
    ORQ_HOME: join(dir, "home"),
    ORQ_BRIDGE: join(dir, "bridge.sock"),
    ORQ_ZELLIJ_SESSION: "orq-bridge-test",
    ORQ_SLACK_TOKENS: join(dir, "slack.env"),
    ORQ_SLACK_USER: "U1",
    ORQ_SLACK_CHANNELS: `C1=${repo}`,
    ORQ_SLACK_API: `http://127.0.0.1:${slack.port}/api`,
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    FAKE_ZELLIJ_DIR: dir,
    ...extra,
  }
  delete e.ZELLIJ
  delete e.ORQ_SANDBOX
  return e
}

const orq = (args: string[], extra: Record<string, string> = {}) => {
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env: env(extra), stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

/** For commands that reach the fake Slack, which runs in this process: spawnSync would block it. */
const orqAsync = async (args: string[]) => {
  const p = Bun.spawn([...ORQ, ...args], { cwd: repo, env: env(), stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code: p.exitCode, out, err }
}

const until = async (what: string, check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const zellijLog = () => {
  try {
    return readFileSync(join(dir, "log"), "utf8")
  } catch {
    return ""
  }
}

/** Slack delivers an event to the bridge. */
const deliver = (event: Record<string, string>) => {
  envelopes++
  ws?.send(JSON.stringify({ type: "events_api", envelope_id: `env-${envelopes}`, payload: { event_id: `ev-${envelopes}`, event } }))
}
const mention = (text: string, ts: string, user = "U1") =>
  deliver({ type: "app_mention", user, channel: "C1", ts, text: `<@UBOT> ${text}` })
const replyIn = (thread: string, text: string, ts: string) =>
  deliver({ type: "message", user: "U1", channel: "C1", ts, thread_ts: thread, text })

const startBridge = async () => {
  bridge = Bun.spawn([...ORQ, "bridge"], { cwd: repo, env: env(), stdout: "ignore", stderr: "pipe" })
  await until("the bridge to connect to Slack", () => ws !== undefined)
}

beforeAll(startPostgres, 120_000)

beforeEach(async () => {
  pg = await freshDatabase()
  dir = mkdtempSync(join(tmpdir(), "orq-bridge-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "bin", "zellij"), FAKE_ZELLIJ)
  chmodSync(join(dir, "bin", "zellij"), 0o755)
  writeFileSync(join(dir, "slack.env"), "SLACK_APP_TOKEN=xapp-test\nSLACK_BOT_TOKEN=xoxb-test\n")
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["commit", "-q", "--allow-empty", "-m", "init"],
  ])
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })

  posts = []
  acks = []
  envelopes = 0
  ws = undefined
  slack = Bun.serve({
    port: 0,
    fetch: async (req, server) => {
      const path = new URL(req.url).pathname
      if (path === "/ws") return server.upgrade(req) ? undefined : new Response("no", { status: 400 })
      if (req.headers.get("authorization") === null) return Response.json({ ok: false, error: "not_authed" })
      if (path === "/api/apps.connections.open") return Response.json({ ok: true, url: `ws://127.0.0.1:${server.port}/ws` })
      if (path === "/api/chat.postMessage") {
        posts.push((await req.json()) as Posted)
        return Response.json({ ok: true, ts: `${200 + posts.length}.000` })
      }
      return Response.json({ ok: false, error: "unknown_method" })
    },
    websocket: {
      open: (socket) => {
        ws = socket
      },
      message: (_socket, m) => {
        acks.push(JSON.parse(String(m)).envelope_id)
      },
    },
  })
})

afterEach(async () => {
  bridge?.kill()
  await bridge?.exited
  bridge = undefined
  slack.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

describe("orq bridge", () => {
  test("your mention in a project's channel starts a task, in a tab, with a thread of its own", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the reply in the thread", () => posts.length > 0)

    expect(posts[0]).toMatchObject({ channel: "C1", thread_ts: "100.1" })
    expect(posts[0]?.text).toContain("T-0001 started: `orq/T-0001-add-search`")
    expect(acks).toEqual(["env-1"])
    expect(orq(["show", "T-0001"]).out).toContain("link slack-thread C1/100.1 (origin)")
    // nobody attached: the tab, then its pane by the tab's id
    expect(zellijLog()).toContain("action new-tab --name orq-T-0001 --cwd")
    expect(zellijLog()).toMatch(/action new-pane --tab-id 1 --cwd \S+ -- env ORQ_TASK=T-0001 .* claude --model opus \/orq:task T-0001/)
  })

  test("listens to you only", async () => {
    await startBridge()
    mention("Not yours", "100.1", "U2")
    mention("Yours", "100.2")
    await until("the reply in the thread", () => posts.length > 0)
    expect(posts.map((p) => p.thread_ts)).toEqual(["100.2"])
    expect(orq(["ls"]).out).not.toContain("Not yours")
  })

  test("your reply in the task's thread is typed into its session, then Enter", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)
    writeFileSync(join(dir, "panes.json"), JSON.stringify([{ id: 2, is_plugin: false, exited: false, tab_name: "orq-T-0001" }]))

    replyIn("100.1", "use the new API", "100.5")
    await until("the typing", () => zellijLog().includes("write --pane-id terminal_2 13"))
    expect(zellijLog()).toContain("write-chars --pane-id terminal_2 \x1b[200~use the new API\x1b[201~")
  })

  test("with the tab closed, your reply opens the session again and continues it", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)

    replyIn("100.1", "use the new API", "100.5")
    await until("the session to open again", () => zellijLog().includes("--continue"))
    expect(zellijLog()).toMatch(/new-pane --tab-id 1 .* claude --model opus --continue use the new API/)
  })

  test("orq ask posts the question in the task's thread, mentioning you, and sets WAITING FOR ME", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)

    const asked = await orqAsync(["ask", "T-0001", "1. Which index?\nI recommend the GIN one."])
    expect(asked.out).toContain("posted in the task's Slack thread")
    expect(posts[1]).toEqual({ channel: "C1", thread_ts: "100.1", text: "<@U1> 1. Which index?\nI recommend the GIN one." })
    expect(orq(["show", "T-0001"]).out).toMatch(/status = WAITING FOR ME[\s\S]*triage: WAITING FOR ME\s+1\. Which index\?/)
  })

  test("a task started in a terminal gets its thread at its first question", async () => {
    await startBridge()
    expect(orq(["new", "Fix login"]).code).toBe(0)

    expect((await orqAsync(["ask", "T-0001", "Which provider?"])).out).toContain("posted")
    expect(posts).toEqual([
      { channel: "C1", text: "T-0001: Fix login" },
      { channel: "C1", thread_ts: "201.000", text: "<@U1> Which provider?" },
    ])
    expect(orq(["show", "T-0001"]).out).toContain("link slack-thread C1/201.000 (related)")
  })

  test("without a bridge, orq ask still sets WAITING FOR ME and says the question stays here", () => {
    expect(orq(["new", "Fix login"]).code).toBe(0)
    const asked = orq(["ask", "T-0001", "Which provider?"])
    expect(asked.code).toBe(0)
    expect(asked.out).toContain("no Slack bridge")
    expect(orq(["show", "T-0001"]).out).toContain("status = WAITING FOR ME")
  })
})
