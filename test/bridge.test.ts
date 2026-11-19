// `orq bridge` against a fake Slack (its Web API and a Socket Mode WebSocket, on localhost) and a
// fake herdr-core `hc` that logs its calls and lists the terminals in terminals.json.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Server, ServerWebSocket, Subprocess } from "bun"
import { ORQ } from "./orq.ts"

const FAKE_HC = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_HC_DIR/log"
case "$1" in
  ls) cat "$FAKE_HC_DIR/terminals.json" 2>/dev/null || echo '{"terminals":[]}' ;;
  run) echo '{"address":"t1"}' ;;
esac
`

interface Posted {
  channel: string
  text: string
  thread_ts?: string
  blocks?: unknown[]
}

let dir: string, repo: string, bridge: Subprocess | undefined
let slack: Server<undefined>, ws: ServerWebSocket<undefined> | undefined
let posts: Posted[], acks: string[], envelopes: number

const env = (extra: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = {
    ...process.env,
    ORQ_DATA: join(dir, "home"),
    ORQ_BRIDGE: join(dir, "bridge.sock"),
    ORQ_HC: join(dir, "bin", "hc"),
    ORQ_SLACK_TOKENS: join(dir, "slack.env"),
    ORQ_SLACK_USER: "U1",
    ORQ_SLACK_CHANNELS: `C1=${repo}`,
    ORQ_SLACK_API: `http://127.0.0.1:${slack.port}/api`,
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    FAKE_HC_DIR: dir,
    ...extra,
  }
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

const hcLog = () => {
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-bridge-"))
  repo = join(dir, "proj")
  mkdirSync(repo)
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "bin", "hc"), FAKE_HC)
  chmodSync(join(dir, "bin", "hc"), 0o755)
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
  test("your mention in a project's channel starts a task, in its session, with a thread of its own", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the reply in the thread", () => posts.length > 0)

    expect(posts[0]).toMatchObject({ channel: "C1", thread_ts: "100.1" })
    expect(posts[0]?.text).toBe("T-0001 started: `orq/T-0001-add-search`")
    expect(posts[0]?.blocks?.[0]).toEqual({ type: "markdown", text: "**T-0001 started:** `orq/T-0001-add-search`" })
    expect(acks).toEqual(["env-1"])
    expect(orq(["show", "T-0001"]).out).toContain("link slack-thread C1/100.1 (origin)")
    expect(hcLog()).toMatch(
      /^run --bg --outlive-parent --name orq-T-0001 --cwd \S+ -- env ORQ_TASK=T-0001 .* claude --model opus \/orq:task T-0001$/m,
    )
  })

  test("playbook=<name> at the start of your mention chooses the task's playbook", async () => {
    await startBridge()
    mention("playbook=bugfix Fix the login", "100.1")
    await until("the reply in the thread", () => posts.length > 0)
    expect(posts[0]?.text).toContain("T-0001 started: `orq/T-0001-fix-the-login`")
    expect(orq(["show", "T-0001"]).out).toMatch(/title = Fix the login[\s\S]*type = bugfix/)
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
    writeFileSync(join(dir, "terminals.json"), JSON.stringify({ terminals: [{ address: "t1", name: "orq-T-0001" }] }))

    replyIn("100.1", "use the new API", "100.5")
    await until("the typing", () => hcLog().includes("send t1 use the new API"))
  })

  test("with its session gone, your reply opens the session again and continues it", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)

    replyIn("100.1", "use the new API", "100.5")
    await until("the session to open again", () => hcLog().includes("--continue"))
    expect(hcLog()).toMatch(/^run --bg .* claude --model opus --continue use the new API$/m)
  })

  test("orq ask posts the message in the task's thread as written (Markdown), mentioning you, and sets WAITING FOR ME", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)

    const message = "**Triage round 1: the index**\n\n**Q2 - Index:** GIN or B-tree?\n- Recommended: GIN - full text"
    const asked = await orqAsync(["ask", "T-0001", message])
    expect(asked.out).toContain("posted in the task's Slack thread")
    expect(posts[1]).toEqual({
      channel: "C1",
      thread_ts: "100.1",
      text: "<@U1> T-0001: Triage round 1: the index",
      blocks: [
        { type: "markdown", text: message },
        { type: "context", elements: [{ type: "mrkdwn", text: "<@U1> · T-0001 · triage · reply in this thread" }] },
      ],
    })
    expect(orq(["show", "T-0001"]).out).toMatch(/status = WAITING FOR ME[\s\S]*triage: WAITING FOR ME\s+Triage round 1: the index/)
  })

  test("orq ask --blocked sets BLOCKED and says so under the message", async () => {
    await startBridge()
    mention("Add search", "100.1")
    await until("the task", () => posts.length > 0)

    expect((await orqAsync(["ask", "--blocked", "T-0001", "**No git remote**"])).out).toContain("T-0001: BLOCKED; posted")
    expect(posts[1]?.blocks?.[1]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "<@U1> · T-0001 · triage · blocked · reply in this thread" }],
    })
    expect(orq(["show", "T-0001"]).out).toMatch(/status = BLOCKED[\s\S]*triage: BLOCKED\s+No git remote/)
  })

  test("a task started in a terminal gets its thread at its first question", async () => {
    await startBridge()
    expect(orq(["new", "Fix login"]).code).toBe(0)

    expect((await orqAsync(["ask", "T-0001", "Which provider?"])).out).toContain("posted")
    expect(posts).toEqual([
      { channel: "C1", text: "T-0001: Fix login" },
      { channel: "C1", thread_ts: "201.000", text: "<@U1> T-0001: Which provider?", blocks: expect.any(Array) },
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
