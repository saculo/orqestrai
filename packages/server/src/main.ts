#!/usr/bin/env bun
// orq-server's entry point: `bun src/main.ts`, and the compiled binary (`bun run build`).
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { OrqConfig } from "@orqestrai/core/config.ts"
import { loadSettings } from "@orqestrai/core/settings.ts"
import { Console, Effect, Layer } from "effect"
import { CliError, Command } from "effect/cli"
import { server } from "./server.ts"
import { VERSION } from "./version.ts"

loadSettings()
// `orq-server serve …`, as orq serve used to be started, is the same as `orq-server …`
if (process.argv[2] === "serve") process.argv.splice(2, 1)

Command.run(server, { version: VERSION }).pipe(
  Effect.tapError((e) => (CliError.isCliError(e) ? Effect.void : Console.error(`orq-server: ${e.message}`))),
  Effect.provide(OrqConfig.layer.pipe(Layer.provideMerge(BunServices.layer))),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
