// How the tests start orq: from the source, or the compiled binary when ORQ_BIN names it
// (the release job runs the whole suite against the file it ships).
import { resolve } from "node:path"

// Never the settings file of whoever runs the tests: orq would read their sandbox, server, …
process.env.ORQ_CONFIG ??= resolve(import.meta.dir, "no-config.toml")

export const ORQ: string[] = process.env.ORQ_BIN
  ? [resolve(process.env.ORQ_BIN)]
  : [process.execPath, resolve(import.meta.dir, "..", "src", "main.ts")]
