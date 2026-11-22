// `orq check` against a fake `just` on PATH: it logs the folder it ran in, and fails where a
// file named fail-check is.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ORQ } from "./orq.ts"

const FAKE_JUST = `#!/usr/bin/env bash
printf '%s %s\\n' "$PWD" "$*" >> "$FAKE_JUST_LOG"
if [ -e fail-check ]; then echo "2 tests failed in $(basename "$PWD")"; exit 1; fi
echo ok
`

let dir: string, repo: string

const sh = (cmd: string[], cwd = repo) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`)
}
const git = (...args: string[]) => sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args])
const write = (path: string, text = "x\n") => {
  mkdirSync(join(repo, path, ".."), { recursive: true })
  writeFileSync(join(repo, path), text)
}

const orq = (args: string[]) => {
  const env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, FAKE_JUST_LOG: join(dir, "log") }
  const p = Bun.spawnSync([...ORQ, ...args], { cwd: repo, env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
const ranIn = () => {
  try {
    return readFileSync(join(dir, "log"), "utf8")
      .trim()
      .split("\n")
      .map(
        (l) =>
          l
            .replace(`${repo}`, "")
            .replace(/^\//, "")
            .replace(/ check$/, "") || ".",
      )
  } catch {
    return []
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-check-"))
  repo = join(dir, "repo")
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "bin", "just"), FAKE_JUST)
  chmodSync(join(dir, "bin", "just"), 0o755)
  mkdirSync(repo)
  sh(["git", "init", "-q", "-b", "main"])
  write(".orqestrai/config.toml", 'base_branch = "main"\ncomponents = ["recipes", "web", "services/*"]\n')
  for (const c of ["recipes", "web", "services/a", "services/b"]) write(`${c}/justfile`, "check:\n\techo ok\n")
  git("add", "-A")
  git("commit", "-q", "-m", "init")
  git("checkout", "-q", "-b", "orq/T-0001-x")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("orq check", () => {
  test("runs just check only in the components the branch changed, committed or not", () => {
    write("recipes/recipe.go")
    git("add", "-A")
    git("commit", "-q", "-m", "recipes")
    write("services/b/new.go") // untracked
    const r = orq(["check"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("pass  recipes")
    expect(r.out).toContain("pass  services/b")
    expect(ranIn()).toEqual(["recipes", "services/b"])
  })

  test("a failing component fails the gate and shows the end of its output", () => {
    write("web/fail-check")
    const r = orq(["check"])
    expect(r.code).not.toBe(0)
    expect(r.out).toContain("fail  web\n  2 tests failed in web")
    expect(r.err).toContain("check failed: web")
  })

  test("a component with no justfile is not configured, not a failure", () => {
    rmSync(join(repo, "web", "justfile"))
    write("web/page.astro")
    const r = orq(["check"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("not configured  web (no justfile)")
  })

  test("nothing changed: nothing to check", () => {
    const r = orq(["check"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("nothing to check")
    expect(ranIn()).toEqual([])
  })

  test("--all checks every component", () => {
    expect(orq(["check", "--all"]).code).toBe(0)
    expect(ranIn()).toEqual(["recipes", "services/a", "services/b", "web"])
  })

  test("without components the repository is one component", () => {
    write(".orqestrai/config.toml", 'base_branch = "main"\n')
    write("justfile", "check:\n\techo ok\n")
    write("src/main.go")
    expect(orq(["check"]).out).toContain("pass  .")
    expect(ranIn()).toEqual(["."])
  })
})
