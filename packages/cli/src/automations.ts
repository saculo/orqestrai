// Automation files: `.orqestrai/automations/<name>.md`. Front matter (provider, event, labels) says
// when it fires; the body is the request template. A bad file fails with its name and the reason.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { OrqError } from "@orqestrai/core/domain.ts"
import { Effect } from "effect"

export type Automation = { file: string; labels: ReadonlyArray<string>; template: string }
/** What a template can name. */
export type Placeholders = { title: string; body: string; url: string; number: string; repo: string }

const KEYS = ["provider", "event", "labels"]
const PLACEHOLDERS: ReadonlyArray<string> = ["title", "body", "url", "number", "repo"]

/** One file's text → its automation, or the reason it is bad. */
export const parseAutomation = (file: string, text: string): Automation => {
  const bad = (reason: string) => new OrqError({ message: `${file}: ${reason}` })
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(text)
  if (!m) throw bad("no front matter; the file starts with --- lines around provider, event and labels")
  const values = new Map<string, string>()
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (!kv) throw bad(`front matter line "${line}" is not "key: value"`)
    const key = kv[1] as string
    if (!KEYS.includes(key)) throw bad(`unknown key "${key}"; the keys are ${KEYS.join(", ")}`)
    values.set(key, (kv[2] ?? "").trim())
  }
  for (const key of KEYS) if (!values.has(key)) throw bad(`missing key "${key}"`)
  if (values.get("provider") !== "github") throw bad(`provider must be github, not "${values.get("provider")}"`)
  if (values.get("event") !== "issue_labeled") throw bad(`event must be issue_labeled, not "${values.get("event")}"`)
  const list = /^\[(.*)\]$/.exec(values.get("labels") as string)
  const labels = list ? (list[1] as string).split(",").map((l) => l.trim().replace(/^(["'])(.*)\1$/, "$2")) : []
  if (!list || labels.some((l) => l === "")) throw bad("labels must be a list like [orq, other]")
  const template = (m[2] ?? "").trim()
  for (const [, name] of template.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g))
    if (!PLACEHOLDERS.includes(name as string))
      throw bad(`unknown placeholder {{${name}}}; the placeholders are ${PLACEHOLDERS.join(", ")}`)
  return { file, labels, template }
}

/** The template with its placeholders filled; the values are not searched for placeholders again. */
export const render = (template: string, values: Placeholders): string =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: keyof Placeholders) => values[name])

/** The automation for `label` in a checkout: the first file by name that names it. Every file must be good. */
export const findAutomation = (project: string, label: string) =>
  Effect.try({
    try: () => {
      const dir = join(project, ".orqestrai", "automations")
      if (!existsSync(dir)) return undefined
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
      const all = files.map((f) => parseAutomation(join(".orqestrai", "automations", f), readFileSync(join(dir, f), "utf8")))
      return all.find((a) => a.labels.includes(label))
    },
    catch: (e) => (e instanceof OrqError ? e : new OrqError({ message: String(e) })),
  })
