// Settings from the environment, read once at the boundary.
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import { Config, Context, Layer } from "effect"

const settings = Config.all({
  /** Worktrees and the archive: $ORQ_HOME. State is in Postgres (src/pg.ts). */
  home: Config.String("ORQ_HOME").pipe(Config.withDefault(join(homedir(), ".orqestrai"))),
  /** zellij session used when orq runs outside zellij */
  session: Config.String("ORQ_ZELLIJ_SESSION").pipe(Config.withDefault("orq")),
  /** command the task session runs inside, e.g. "fence --" for the Fence sandbox; empty: none */
  sandbox: Config.String("ORQ_SANDBOX").pipe(Config.withDefault("")),
  /** model for the interactive task session */
  model: Config.String("ORQ_SESSION_MODEL").pipe(Config.withDefault("opus")),
  /** this machine's name for its verify slots */
  host: Config.String("ORQ_HOST").pipe(Config.withDefault(hostname())),
  /** verify slots on this machine */
  slots: Config.Int("ORQ_SLOTS").pipe(Config.withDefault(1)),
  /** first port of slot 1; slot n starts 100 ports later each */
  portStart: Config.Int("ORQ_PORT_START").pipe(Config.withDefault(4100)),
  /** seconds before a slot expires */
  slotTtl: Config.Int("ORQ_SLOT_TTL").pipe(Config.withDefault(7200)),
  /** command that serves a kept app's port to you, with {port}; e.g. tailscale serve */
  serve: Config.String("ORQ_SERVE").pipe(Config.withDefault("")),
  /** command that stops serving it */
  unserve: Config.String("ORQ_UNSERVE").pipe(Config.withDefault("")),
})

export class OrqConfig extends Context.Service<OrqConfig, Config.Success<typeof settings>>()("orq/Config") {
  static readonly layer = Layer.effect(OrqConfig, settings)
}
