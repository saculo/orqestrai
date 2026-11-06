// Settings from the environment, read once at the boundary.

import { homedir, hostname } from "node:os"
import { join, resolve } from "node:path"
import { Config, Context, Effect, Layer } from "effect"

export class OrqConfig extends Context.Service<
  OrqConfig,
  {
    /** Worktrees and the archive: $ORQ_HOME, default ~/.orqestrai. State is in Postgres (src/pg.ts). */
    readonly home: string
    /** zellij session used when orq runs outside zellij */
    readonly session: string
    /** model for the interactive task session */
    readonly model: string
    /** the orqestrai checkout (templates live here) */
    readonly root: string
    /** this machine's name for its verify slots: $ORQ_HOST, default the hostname */
    readonly host: string
    /** verify slots on this machine: $ORQ_SLOTS, default 1 */
    readonly slots: number
    /** first port of slot 1; slot n starts 100 ports later each: $ORQ_PORT_START, default 4100 */
    readonly portStart: number
    /** seconds before a slot expires: $ORQ_SLOT_TTL, default 2 hours */
    readonly slotTtl: number
    /** command that serves a kept app's port to you, with {port}: $ORQ_SERVE, e.g. tailscale serve */
    readonly serve: string
    /** command that stops serving it: $ORQ_UNSERVE */
    readonly unserve: string
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
        host: yield* Config.String("ORQ_HOST").pipe(Config.withDefault(hostname())),
        slots: yield* Config.Int("ORQ_SLOTS").pipe(Config.withDefault(1)),
        portStart: yield* Config.Int("ORQ_PORT_START").pipe(Config.withDefault(4100)),
        slotTtl: yield* Config.Int("ORQ_SLOT_TTL").pipe(Config.withDefault(7200)),
        serve: yield* Config.String("ORQ_SERVE").pipe(Config.withDefault("")),
        unserve: yield* Config.String("ORQ_UNSERVE").pipe(Config.withDefault("")),
      }
    }),
  )
}
