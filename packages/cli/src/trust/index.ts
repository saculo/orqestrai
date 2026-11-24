// Claude Code asks "do you trust this folder?" the first time it runs in one, and a task session
// started by orq would wait on that dialog. The answer is kept in Claude's config file,
// `projects[<folder>].hasTrustDialogAccepted`: orq sets it for a task's worktree, and removes the
// entry when the worktree is cleaned. Nothing else in the file is touched.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Effect } from "effect"

const configFile = () => join(process.env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json")

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)

/** Reads the file, lets `change` edit it, and writes it back through a temp file and a rename. A file
 * that is not a JSON object is left alone with a warning: overwriting it would destroy the user's Claude config. */
const edit = (change: (config: Json) => boolean, create: boolean) =>
  Effect.sync(() => {
    const link = configFile()
    // a symlinked config is edited at its real target, so the link stays
    const file = existsSync(link) ? realpathSync(link) : link
    let config: Json = {}
    if (existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
        if (!isObject(parsed)) throw new Error("not a JSON object")
        config = parsed
      } catch {
        console.error(`orq: ${file} is not valid JSON, left as it is; Claude will ask to trust the folder`)
        return
      }
    } else if (!create) return
    if (!change(config)) return
    const tmp = join(dirname(file), `.claude.json.orq-${process.pid}`)
    try {
      mkdirSync(dirname(file), { recursive: true })
      // the file keeps its mode; a new one is private, it holds account data
      const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600
      writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode })
      chmodSync(tmp, mode)
      renameSync(tmp, file)
    } catch (e) {
      console.error(`orq: cannot write ${file}: ${e instanceof Error ? e.message : e}`)
    }
  })

/** Marks the worktree as trusted in Claude's config; the entry's other fields stay. */
export const trust = (worktree: string) =>
  edit((config) => {
    const projects = isObject(config.projects) ? config.projects : {}
    const entry = isObject(projects[worktree]) ? projects[worktree] : {}
    projects[worktree] = { ...entry, hasTrustDialogAccepted: true }
    config.projects = projects
    return true
  }, true)

/** Removes the worktree's entry from Claude's config. */
export const untrust = (worktree: string) =>
  edit((config) => {
    if (!isObject(config.projects) || !(worktree in config.projects)) return false
    delete config.projects[worktree]
    return true
  }, false)
