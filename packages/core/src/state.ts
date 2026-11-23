// orq's state service (tasks). With ORQ_SERVER set the CLI goes through the server
// (remote.ts) and never opens the file; without it, it opens $ORQ_DATA/state.db. The server
// always opens the file (Direct).
import { Config, Effect, Layer, Option } from "effect"
import type { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import type { OrqError } from "./domain.ts"
import { Remote } from "./remote.ts"
import { Database } from "./sqlite.ts"

/** Db on the open, migrated SQLite file. The server always uses this one. */
export const Direct = Db.layer.pipe(Layer.provideMerge(Database))

export const State = Layer.unwrap(
  Config.String("ORQ_SERVER").pipe(
    Config.option,
    Effect.map((server): Layer.Layer<Db, OrqError | Config.ConfigError, OrqConfig> => (Option.isSome(server) ? Remote : Direct)),
  ),
)
