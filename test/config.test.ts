// orq's settings file (~/.config/orqestrai/config.toml, or ORQ_CONFIG): each key fills in
// its ORQ_<KEY> variable, and a variable that is set wins.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { settingsEnv } from "../src/settings.ts"
import { ORQ } from "./orq.ts"

let dir: string, repo: string, config: string

const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}

const orq = (args: string[], toml: string, extra: Record<string, string> = {}) => {
  writeFileSync(config, toml)
  const env = { ...process.env, ORQ_CONFIG: config, ORQ_HC: "orq-test-no-hc", ...extra } as Record<string, string | undefined>
  for (const k of ["ORQ_DATA", "ORQ_SANDBOX", "ORQ_ADD_DIRS", "ORQ_MODEL"]) if (!(k in extra)) delete env[k]
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-config-"))
  repo = join(dir, "proj")
  config = join(dir, "config.toml")
  mkdirSync(repo)
  sh(["git", "init", "-q", "-b", "main"], repo)
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("the settings file", () => {
  test("gives the task session its sandbox, directories, model and data folder", () => {
    const r = orq(["new", "x"], `sandbox = "fence --"\nadd_dirs = ["/srv/home", "~/shared"]\nmodel = "sonnet"\ndata = "${dir}/data"\n`)
    expect(r.code).toBe(0)
    expect(r.out).toContain(`cd ${dir}/data/worktrees/`)
    expect(r.out).toMatch(/&& fence -- env ORQ_TASK=T-0001 .* claude --model sonnet --add-dir=\/srv\/home --add-dir=\S+\/shared /)
    expect(r.out).toContain(`--add-dir=${homedir()}/shared`)
  })

  test("a variable that is set wins over the file", () => {
    const r = orq(["new", "x"], `data = "${dir}/data"\nmodel = "sonnet"\n`, { ORQ_MODEL: "haiku" })
    expect(r.out).toContain("claude --model haiku")
  })

  test("without the file, orq uses its defaults", () => {
    rmSync(config, { force: true })
    const env: Record<string, string | undefined> = {
      ...process.env,
      ORQ_HC: "orq-test-no-hc",
      ORQ_CONFIG: join(dir, "missing.toml"),
      ORQ_DATA: join(dir, "data"),
    }
    const p = Bun.spawnSync([...ORQ, "new", "x"], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
    expect(p.exitCode).toBe(0)
    expect(p.stdout.toString()).toContain("claude --model opus")
  })

  test("rejects a key it does not know, so a typo is not silently ignored", () => {
    const r = orq(["ls"], `sandboxx = "fence --"\n`)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("sandboxx")
  })

  test("rejects a file that is not TOML", () => {
    const r = orq(["ls"], `sandbox = \n`)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(config)
  })
})

describe("settingsEnv", () => {
  test("maps [slack] to the bridge's variables, a channel to the checkout where its tasks start", () => {
    const env = settingsEnv({ slack: { user: "U1", tokens: "/t/slack.env", channels: { C1: "/p/app", C2: "/p/lib" } } })
    expect(env).toEqual({ ORQ_SLACK_USER: "U1", ORQ_SLACK_TOKENS: "/t/slack.env", ORQ_SLACK_CHANNELS: "C1=/p/app,C2=/p/lib" })
  })

  test("maps [github] to orq issues' variables, a repo to the checkout where its tasks start", () => {
    const env = settingsEnv({ github: { user: "me", repos: { "me/app": "/p/app", "me/lib": "/p/lib" } } })
    expect(env).toEqual({ ORQ_GITHUB_USER: "me", ORQ_GITHUB_REPOS: "me/app=/p/app,me/lib=/p/lib" })
  })

  test("rejects a key [github] does not know", () => {
    expect(() => settingsEnv({ github: { user: "me", label: "orq" } })).toThrow("unknown key github.label")
  })
})
