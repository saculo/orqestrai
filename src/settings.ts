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
  zellij_session: "ORQ_ZELLIJ_SESSION",
}
const TABLES = ["add_dirs", "slack", "projects"]

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
    only(slack, ["user", "tokens"], "slack.")
    if (slack.user !== undefined) env.ORQ_SLACK_USER = path(slack.user, "slack.user")
    if (slack.tokens !== undefined) env.ORQ_SLACK_TOKENS = path(slack.tokens, "slack.tokens")
  }
  if (s.projects !== undefined) {
    const channels = Object.entries(table(s.projects, "projects")).flatMap(([name, v]) => {
      const p = table(v, `projects.${name}`)
      only(p, ["path", "slack_channel"], `projects.${name}.`)
      const dir = path(p.path, `projects.${name}.path`)
      return p.slack_channel === undefined ? [] : [`${path(p.slack_channel, `projects.${name}.slack_channel`)}=${dir}`]
    })
    if (channels.length > 0) env.ORQ_SLACK_CHANNELS = channels.join(",")
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
