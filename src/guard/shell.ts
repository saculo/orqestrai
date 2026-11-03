// Splits a shell command line into simple commands, so each one can be checked by itself.
// Plain TypeScript: no Effect, no bun:* imports.
import { parse } from "shell-quote"

const SHELLS = new Set(["bash", "sh", "zsh", "dash"])
const PREFIXES = new Set(["sudo", "command", "exec", "env", "nohup", "time"])
const SEPARATORS = new Set(["&&", "||", ";", ";;", "|", "|&", "&", "(", ")"])
const isPrefix = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || PREFIXES.has(word)

/**
 * Every simple command in `text`, as its words: split on lines, `&&`, `||`, `;`, pipes and
 * subshells, without `VAR=x`, `sudo`, `env` and similar prefixes. The text inside
 * `bash -c "…"` and `eval …` is split the same way. `$VAR` stays as written, so a rule can
 * refuse a path it cannot check instead of guessing it.
 */
export const simpleCommands = (text: string): string[][] => {
  const out: string[][] = []
  const add = (words: string[]) => {
    let w = words
    while (w[0] !== undefined && isPrefix(w[0])) w = w.slice(1)
    const [cmd, ...args] = w
    if (!cmd) return
    if (SHELLS.has(cmd)) {
      const inner = args[args.indexOf("-c") + 1]
      if (args.includes("-c") && inner) out.push(...simpleCommands(inner))
      return
    }
    if (cmd === "eval") return void out.push(...simpleCommands(args.join(" ")))
    out.push(w)
  }

  for (const line of text.split("\n")) {
    let words: string[] = []
    for (const t of parse(line, (key) => `$${key}`)) {
      if (typeof t === "string") words.push(t)
      else if ("op" in t && t.op === "glob") words.push((t as { pattern: string }).pattern)
      else if ("op" in t && SEPARATORS.has(t.op)) {
        add(words)
        words = []
      } else if ("comment" in t) break
    }
    add(words)
  }
  return out
}
