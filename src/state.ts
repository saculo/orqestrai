// orq's state service (tasks), given only to the commands that read or write
// state, so `orq init` and `orq file` never connect. With ORQ_SERVER set they go through
// `orq serve` (src/remote.ts) and never open the file; without it they open $ORQ_DATA/state.db.
import { Config, Effect, Layer, Option } from "effect"
import { Command } from "effect/cli"
import type { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import type { OrqError } from "./domain.ts"
import { Remote } from "./remote.ts"
import { Database } from "./sqlite.ts"

/** Db on the open, migrated SQLite file. `orq serve` always uses this one. */
export const Direct = Db.layer.pipe(Layer.provideMerge(Database))

export const State = Layer.unwrap(
  Config.String("ORQ_SERVER").pipe(
    Config.option,
    Effect.map((server): Layer.Layer<Db, OrqError | Config.ConfigError, OrqConfig> => (Option.isSome(server) ? Remote : Direct)),
  ),
)

export const withState = <const Name extends string, Input, ContextInput, E, R>(self: Command.Command<Name, Input, ContextInput, E, R>) =>
  Command.provide(self, State)
