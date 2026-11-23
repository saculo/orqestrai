// How the tests start orq and orq-server: from the source, or the compiled binaries when
// ORQ_BIN and ORQ_SERVER_BIN name them (the release job runs the whole suite against the files it ships).
import { resolve } from "node:path"

// Never the settings file of whoever runs the tests: orq would read their sandbox, server, …
process.env.ORQ_CONFIG ??= resolve(import.meta.dir, "no-config.toml")

const source = (pkg: string) => [process.execPath, resolve(import.meta.dir, "..", "packages", pkg, "src", "main.ts")]

export const ORQ: string[] = process.env.ORQ_BIN ? [resolve(process.env.ORQ_BIN)] : source("cli")
export const ORQ_SERVER: string[] = process.env.ORQ_SERVER_BIN ? [resolve(process.env.ORQ_SERVER_BIN)] : source("server")
