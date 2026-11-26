// `orq trigger github`: an issue labeled → the rendered automation goes to the trigger port.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { ORQ } from "./orq.ts"
import { startServer } from "./server.ts"

const TOKEN = "s3cret-token"
let dir: string, checkout: string, server: Subprocess, main: number, trig: number

const automation = (name: string, text: string) => {
  mkdirSync(join(checkout, ".orqestrai", "automations"), { recursive: true })
  writeFileSync(join(checkout, ".orqestrai", "automations", name), text)
}
const good =
  "---\nprovider: github\nevent: issue_labeled\nlabels: [orq]\n---\n\nIssue {{number}} in {{repo}}: {{title}}\n\n{{body}}\n{{url}}\n"

const trigger = (label: string, action = "labeled") => {
  const event = join(dir, "event.json")
  writeFileSync(
    event,
    JSON.stringify({
      action,
      label: { name: label },
      issue: { number: 12, title: "Plan the week", body: "Meals, please", html_url: "https://github.com/acme/app/issues/12" },
      repository: { full_name: "acme/app" },
    }),
  )
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: event,
    ORQ_TRIGGER_URL: `http://127.0.0.1:${trig}`,
    ORQ_TRIGGER_TOKEN: TOKEN,
    ORQ_DATA: join(dir, "home"),
  }
  const p = Bun.spawnSync([...ORQ, "trigger", "github"], { cwd: checkout, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
const tasks = async () => (await (await fetch(`http://127.0.0.1:${main}/tasks`)).json()) as Array<{ id: string }>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "orq-automations-"))
  checkout = join(dir, "checkout")
  mkdirSync(checkout)
  Bun.spawnSync(["git", "init", "-q"], { cwd: checkout })
  main = 20000 + Math.floor(Math.random() * 10000)
  trig = main + 1
  server = await startServer(main, { ORQ_DATA: join(dir, "server"), ORQ_TRIGGER_TOKEN: TOKEN }, undefined, undefined, trig)
})
afterEach(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe("orq trigger github", () => {
  test("B10: a matching label adds the task with the rendered template as its request", async () => {
    automation("issue.md", good)
    const r = trigger("orq")
    expect(r.code).toBe(0)
    const id = r.out.trim().split(" ")[0] as string
    expect(r.out.trim()).toBe(`${id} added`)
    expect((await tasks()).map((t) => t.id)).toEqual([id])
    const file = (await (await fetch(`http://127.0.0.1:${main}/tasks/${id}/copy?path=REQUEST.md`)).json()) as string
    expect(Buffer.from(file, "base64").toString()).toEndWith(
      "---\n\nIssue 12 in acme/app: Plan the week\n\nMeals, please\nhttps://github.com/acme/app/issues/12\n",
    )
    expect(trigger("orq").out.trim()).toBe(`${id} already there`)
  })

  test("B11: a label no automation names, or another action, does nothing and exits 0", async () => {
    automation("issue.md", good)
    const other = trigger("bug")
    expect(other.code).toBe(0)
    expect(other.out).toContain("no automation matched")
    expect(trigger("orq", "opened").code).toBe(0)
    expect(await tasks()).toHaveLength(0)
  })

  test.each([
    ["an unknown key", "---\nprovider: github\nevent: issue_labeled\nlabels: [orq]\nstart: no\n---\nhi", 'unknown key "start"'],
    ["an unknown placeholder", good.replace("{{title}}", "{{colour}}"), "unknown placeholder {{colour}}"],
    ["bad front matter", "provider: github\nhello", "no front matter"],
  ])("B12: %s fails naming the file", async (_, text, reason) => {
    automation("a-good.md", good.replace("[orq]", "[other]"))
    automation("bad.md", text)
    const r = trigger("orq")
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("bad.md")
    expect(r.err).toContain(reason)
    expect(await tasks()).toHaveLength(0)
  })

  test("missing variables are named", () => {
    const p = Bun.spawnSync([...ORQ, "trigger", "github"], {
      cwd: checkout,
      env: { ...process.env, GITHUB_EVENT_PATH: "", ORQ_TRIGGER_URL: "", ORQ_TRIGGER_TOKEN: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(p.exitCode).not.toBe(0)
    expect(p.stderr.toString()).toContain("ORQ_TRIGGER_TOKEN")
  })
})
