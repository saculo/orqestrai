// Settings from the environment, read once at the boundary.
import { homedir } from "node:os"
import { join } from "node:path"
import { Config, Context, Layer } from "effect"

const settings = Config.all({
  /** Worktrees and the archive: $ORQ_DATA (the settings file's `data`). State is in Postgres (src/pg.ts). */
  home: Config.String("ORQ_DATA").pipe(Config.withDefault(join(homedir(), ".orqestrai"))),
  /** the Slack bridge's socket, where `orq ask` sends a question (orq bridge) */
  bridge: Config.String("ORQ_BRIDGE").pipe(Config.withDefault(join(homedir(), ".orqestrai", "bridge.sock"))),
  /** zellij session used when orq runs outside zellij */
  session: Config.String("ORQ_ZELLIJ_SESSION").pipe(Config.withDefault("orq")),
  /** command the task session runs inside, e.g. "fence --" for the Fence sandbox; empty: none */
  sandbox: Config.String("ORQ_SANDBOX").pipe(Config.withDefault("")),
  /** directories every task session also gets, with --add-dir, separated by ":" (e.g. a home repo's shared skills) */
  addDirs: Config.String("ORQ_ADD_DIRS").pipe(Config.withDefault("")),
  /** model for the interactive task session */
  model: Config.String("ORQ_MODEL").pipe(Config.withDefault("opus")),
})

export class OrqConfig extends Context.Service<OrqConfig, Config.Success<typeof settings>>()("orq/Config") {
  static readonly layer = Layer.effect(OrqConfig, settings)
}
