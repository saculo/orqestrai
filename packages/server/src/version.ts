// orq-server's version, from its package.json; the release tag sets it.
import pkg from "../package.json" with { type: "json" }

export const VERSION: string = pkg.version
