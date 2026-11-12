// The Claude Code plugin (plugin/): every skill and agent is where Claude Code looks for it, under
// the name the others call it by, and the plugin starts orq for the guard hook.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const PLUGIN = join(ROOT, "plugin")
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"))
const manifest = json("plugin/.claude-plugin/plugin.json")
const frontmatter = (file: string) =>
  Bun.YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"))?.[1] ?? "") as Record<string, unknown>
const glob = (pattern: string, cwd: string) => [...new Bun.Glob(pattern).scanSync({ cwd, absolute: true })]

const skills = (manifest.skills as string[]).flatMap((dir) => glob("*/SKILL.md", join(PLUGIN, dir)))
const agents = glob("agents/*.md", PLUGIN)

describe("the orq plugin", () => {
  test("each skill and agent is named as its folder or file, with a description", () => {
    expect(skills.length).toBeGreaterThan(20)
    for (const f of skills) expect(frontmatter(f)).toMatchObject({ name: basename(dirname(f)), description: expect.any(String) })
    for (const f of agents) expect(frontmatter(f)).toMatchObject({ name: basename(f, ".md"), description: expect.any(String) })
  })

  test("every orq:<name> a skill, an agent or orq mentions is a skill or an agent of the plugin", () => {
    const names = new Set([...skills.map((f) => basename(dirname(f))), ...agents.map((f) => basename(f, ".md"))])
    const files = [...glob("**/*.md", PLUGIN), join(ROOT, "src", "zellij.ts")]
    const mentioned = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\borq:([a-z][a-z-]*)/g)].map((m) => m[1]))
    expect(mentioned.length).toBeGreaterThan(50)
    expect(mentioned.filter((n) => !names.has(n as string))).toEqual([])
  })

  test("the guard hook starts orq by name", () => {
    expect(json("plugin/hooks/hooks.json").hooks.PreToolUse[0].hooks[0].command).toBe("orq guard")
  })

  test("the plugin is named orq, as the orq:<name> skills and agents are called", () => {
    expect(manifest.name).toBe("orq")
  })

  test("the marketplace lists the plugin, at orq's version", () => {
    expect(json(".claude-plugin/marketplace.json").plugins).toMatchObject([{ name: manifest.name, source: "./plugin" }])
    expect(manifest.version).toBe(json("package.json").version)
  })
})
