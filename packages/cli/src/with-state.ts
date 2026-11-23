// The state (tasks), given only to the commands that read or write it, so `orq init` and
// `orq create-artifact` never connect.
import { State } from "@orqestrai/core/state.ts"
import { Command } from "effect/cli"

export const withState = <const Name extends string, Input, ContextInput, E, R>(self: Command.Command<Name, Input, ContextInput, E, R>) =>
  Command.provide(self, State)
