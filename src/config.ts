// Settings from the environment, read once at the boundary.

import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { Config, Context, Effect, Layer } from "effect"

export class OrqConfig extends Context.Service<
  OrqConfig,
  {
    /** State and worktrees: $ORQ_HOME, default ~/.orqestrai */
    readonly home: string
    /** zellij session used when orq runs outside zellij */
    readonly session: string
    /** model for the interactive task session */
    readonly model: string
    /** the orqestrai checkout (templates live here) */
    readonly root: string
  }
>()("orq/Config") {
  static readonly layer = Layer.effect(
    OrqConfig,
    Effect.gen(function* () {
      return {
        home: yield* Config.String("ORQ_HOME").pipe(Config.withDefault(join(homedir(), ".orqestrai"))),
        session: yield* Config.String("ORQ_ZELLIJ_SESSION").pipe(Config.withDefault("orq")),
        model: yield* Config.String("ORQ_SESSION_MODEL").pipe(Config.withDefault("opus")),
        root: resolve(import.meta.dir, ".."),
      }
    }),
  )
}
