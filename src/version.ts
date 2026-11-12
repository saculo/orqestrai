// orq's version, from package.json; the release tag sets it.
import pkg from "../package.json" with { type: "json" }

export const VERSION: string = pkg.version
