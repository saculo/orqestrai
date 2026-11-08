// orq's state services (tasks and verify slots) on a connected, migrated database.
// Given only to the commands that read or write state, so `orq init` and `orq file` never connect.
import { Layer } from "effect"
import { Command } from "effect/cli"
import { Db } from "./db.ts"
import { Database } from "./pg.ts"
import { Slots } from "./slots.ts"

export const State = Layer.mergeAll(Db.layer, Slots.layer).pipe(Layer.provideMerge(Database))

export const withState = <const Name extends string, Input, ContextInput, E, R>(self: Command.Command<Name, Input, ContextInput, E, R>) =>
  Command.provide(self, State)
