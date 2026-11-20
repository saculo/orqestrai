// The settings file, ~/.config/orqestrai/config.toml (ORQ_CONFIG names another). Each key fills
// in its ORQ_<KEY> variable before anything reads it; a variable that is already set wins.
// So the rest of orq reads only variables, and tests and containers can still set them.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type Settings = Record<string, unknown>

const KEYS: Record<string, string> = {
  server: "ORQ_SERVER",
  sandbox: "ORQ_SANDBOX",
  model: "ORQ_MODEL",
  data: "ORQ_DATA",
  hc: "ORQ_HC",
}
const TABLES = ["add_dirs", "slack", "github"]

const path = (v: unknown, key: string) => {
  if (typeof v !== "string") throw new Error(`${key} must be a string`)
  return v.startsWith("~/") ? join(homedir(), v.slice(2)) : v
}

const table = (v: unknown, key: string) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`[${key}] must be a table`)
  return v as Settings
}

const only = (t: Settings, allowed: string[], where: string) => {
  for (const k of Object.keys(t)) if (!allowed.includes(k)) throw new Error(`unknown key ${where}${k}`)
}

/** The variables a parsed settings file gives, with `~/` expanded in paths. */
export const settingsEnv = (s: Settings): Record<string, string> => {
  only(s, [...Object.keys(KEYS), ...TABLES], "")
  const env: Record<string, string> = {}
  for (const [key, name] of Object.entries(KEYS)) if (s[key] !== undefined) env[name] = path(s[key], key)
  if (s.add_dirs !== undefined) {
    if (!Array.isArray(s.add_dirs)) throw new Error("add_dirs must be a list of paths")
    env.ORQ_ADD_DIRS = s.add_dirs.map((d) => path(d, "add_dirs")).join(":")
  }
  if (s.slack !== undefined) {
    const slack = table(s.slack, "slack")
    only(slack, ["user", "tokens", "channels"], "slack.")
    if (slack.user !== undefined) env.ORQ_SLACK_USER = path(slack.user, "slack.user")
    if (slack.tokens !== undefined) env.ORQ_SLACK_TOKENS = path(slack.tokens, "slack.tokens")
    // each channel and the checkout where its tasks start
    if (slack.channels !== undefined)
      env.ORQ_SLACK_CHANNELS = Object.entries(table(slack.channels, "slack.channels"))
        .map(([channel, dir]) => `${channel}=${path(dir, `slack.channels.${channel}`)}`)
        .join(",")
  }
  if (s.github !== undefined) {
    const github = table(s.github, "github")
    only(github, ["user", "repos"], "github.")
    if (github.user !== undefined) env.ORQ_GITHUB_USER = path(github.user, "github.user")
    // each repo and the checkout where its tasks start
    if (github.repos !== undefined)
      env.ORQ_GITHUB_REPOS = Object.entries(table(github.repos, "github.repos"))
        .map(([repo, dir]) => `${repo}=${path(dir, `github.repos.${repo}`)}`)
        .join(",")
  }
  return env
}

/** Reads the settings file, if there is one, into process.env. Exits on a bad file. */
export const loadSettings = () => {
  const file = process.env.ORQ_CONFIG ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "orqestrai", "config.toml")
  if (!existsSync(file)) return
  try {
    const env = settingsEnv(Bun.TOML.parse(readFileSync(file, "utf8")) as Settings)
    for (const [name, value] of Object.entries(env)) process.env[name] ??= value
  } catch (e) {
    console.error(`orq: ${file}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
}
