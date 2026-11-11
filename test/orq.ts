// How the tests start orq: from the source, or the compiled binary when ORQ_BIN names it
// (the release job runs the whole suite against the file it ships).
import { resolve } from "node:path"

export const ORQ: string[] = process.env.ORQ_BIN
  ? [resolve(process.env.ORQ_BIN)]
  : [process.execPath, resolve(import.meta.dir, "..", "src", "main.ts")]
