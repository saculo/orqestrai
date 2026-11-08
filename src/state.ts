// orq's state services (tasks and verify slots), given only to the commands that read or write
// state, so `orq init` and `orq file` never connect. With ORQ_SERVER set they go through
// `orq serve` (src/remote.ts) and need no database password; without it they connect directly.
import { Config, Effect, Layer, Option } from "effect"
import { Command } from "effect/cli"
import type { OrqConfig } from "./config.ts"
import { Db } from "./db.ts"
import type { OrqError } from "./domain.ts"
import { Database } from "./pg.ts"
import { Remote } from "./remote.ts"
import { Slots } from "./slots.ts"

/** Db and Slots on a connected, migrated database. `orq serve` always uses this one. */
export const Direct = Layer.mergeAll(Db.layer, Slots.layer).pipe(Layer.provideMerge(Database))

export const State = Layer.unwrap(
  Config.String("ORQ_SERVER").pipe(
    Config.option,
    Effect.map((server): Layer.Layer<Db | Slots, OrqError | Config.ConfigError, OrqConfig> => (Option.isSome(server) ? Remote : Direct)),
  ),
)

export const withState = <const Name extends string, Input, ContextInput, E, R>(self: Command.Command<Name, Input, ContextInput, E, R>) =>
  Command.provide(self, State)
