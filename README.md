# orqestrai

An orchestrated software factory with human gates:
triage → plan → impl → verify → learn → ship. The design is in [DESIGN.md](DESIGN.md).

Status: slice 2 — `orq new`, and a task session that runs triage, plan, impl and verify.

## Install (Claude Code)

Two pieces, once per machine. **The `orq` program**, one file from the latest release
(Linux x64; it must be on PATH, because the plugin starts it by name):

```bash
cd /tmp
curl -fsSLO https://github.com/saculo/orqestrai/releases/latest/download/orq-linux-x64
curl -fsSLO https://github.com/saculo/orqestrai/releases/latest/download/orq-linux-x64.sha256
sha256sum -c orq-linux-x64.sha256 && install -D -m 755 orq-linux-x64 ~/.local/bin/orq
```

**The Claude Code plugin**, with the skills, agents and guard hook:

```bash
claude plugin marketplace add saculo/orqestrai
claude plugin install orq@orqestrai
```

Then, in each project's git repository, `orq init` writes `.orqestrai/config.toml`: the
base branch and the commands of the quality gate.

From a checkout instead: `bun install`, `ln -s "$PWD/bin/orq" ~/.local/bin/orq`, and
`claude --plugin-dir ./plugin`. `bun run build` writes the binary to `dist/orq`. A tag
`v<version>` (as in `package.json` and `plugin/.claude-plugin/plugin.json`) releases it.

### Running `orq serve`

On one machine, orq connects to Postgres itself, from libpq's `PG*` variables. To keep the
login away from the sessions, run `orq serve` with them instead, and give the clients only
`ORQ_SERVER`:

```bash
PG...=... orq serve --socket /run/orq/orq.sock           # same machine: ORQ_SERVER=/run/orq/orq.sock
PG...=... orq serve --host 10.0.0.2 --port 7400          # another machine: ORQ_SERVER=http://10.0.0.2:7400
```

The socket's directory must be writable by the server's user (a systemd `RuntimeDirectory=orq`
makes `/run/orq`), and the socket's permissions decide who may call it. Over TCP the server
does not authenticate callers: anyone who reaches the port can change any task. `--host`
defaults to `127.0.0.1`; on another machine, listen on a private address and let the network
admit only the sessions' machine (Tailscale ACLs, network policies). The image
`ghcr.io/saculo/orqestrai:<version>` runs `orq serve --host 0.0.0.0 --port 7400`, so it needs
the same.

## Use

In a project's git repository:

```bash
orq new "what you want"     # id, branch, worktree, zellij tab running /orq:task <id>
orq ls                      # all tasks
orq show T-0001             # one task, its links and its last events
orq open T-0001             # open the task's tab again, for example after a restart
orq send T-0001 "go on"     # type a message into the task's session
```

Always start a task session with `orq new` or `orq open`. They set `ORQ_TASK`, and the
guard hooks are active only when it is set.

Inside zellij, `orq new` opens a new tab. Outside, it uses the zellij session
`$ORQ_ZELLIJ_SESSION` (default `orq`) if it exists, or prints the command to run.
`ORQ_SANDBOX` is a command the session starts inside, e.g. `fence --` for the
[Fence](https://github.com/fencesandbox/fence) sandbox: `fence -- env ORQ_TASK=… claude …`.

**Slack.** `orq bridge` connects a Slack app (Socket Mode) to the sessions: `@orq <request>`
in a project's channel starts a task with its own thread, a session's questions
(`orq ask`) are posted there, and your replies are typed into the session. It reads
`SLACK_APP_TOKEN=xapp-…` and `SLACK_BOT_TOKEN=xoxb-…` lines from `ORQ_SLACK_TOKENS`
(default `~/.config/orq-bridge/slack.env`; hide it from the sandbox), listens to
`ORQ_SLACK_USER` only, and maps channels to checkouts with
`ORQ_SLACK_CHANNELS=C0123=/path/to/repo,…`. The app, from a manifest (api.slack.com/apps,
Create New App, From a manifest):

```yaml
display_information: { name: orq }
features: { bot_user: { display_name: orq, always_online: true } }
oauth_config:
  scopes: { bot: [app_mentions:read, channels:history, groups:history, chat:write] }
settings:
  event_subscriptions: { bot_events: [app_mention, message.channels, message.groups] }
  socket_mode_enabled: true
```

Then install it to the workspace (the bot token), make an app-level token with
`connections:write` (Basic Information), and `/invite @orq` in each project's channel.

State is in Postgres: orq reads libpq's `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`,
`PGPASSWORD` and `PGSSLMODE` (`require` by default; `verify-ca` with `PGSSLROOTCERT`).
`orq guard` and `orq init` need no database. `orq serve` is the one process that connects,
on a Unix socket (`--socket <path>`) or a TCP address (`--host <ip> --port <n>`): set
`ORQ_SERVER` to the path or to `http://<ip>:<n>` and every other command goes through it,
with no `PG*` variable. Worktrees are in
`~/.orqestrai/worktrees/<repo>/` (`ORQ_HOME`). Tests start their own Postgres with
testcontainers, so they need Docker. Task files are in `.orqestrai/tasks/<id>/` in the worktree.

## Layout

```
src/                     orq: TypeScript, Effect 4, Bun. Mechanics only. src/main.ts starts it
bin/orq                  runs src/main.ts from a checkout; releases ship a compiled binary
test/                    CLI, server, guard and plugin tests (bun run test)
templates/               task files; `orq file <id> <NAME>` writes one (built into orq)
plugin/                  the Claude Code plugin `orq`:
  skills/workflow/       task (the orchestrator), triage, plan, impl, verify (steps), grill
                         (how they ask questions), git (branch, staging, commit, push)
  skills/modeling/       problem-class, consistency-unit, context-distilling: tools that
                         plan and grill load on signals
  skills/principles/     short principles that steps load; test-behavior has GUIDELINES.md
  agents/                researcher (neutral code research), implementer (one task, test
                         first), verifier (drives the app, never reads code), reviewer
  hooks/                 the guard hook (`orq guard`)
src/guard/               `orq guard`: guards G1–G4 for task sessions (PreToolUse hook)
```

## Secrets on a VPS (second lock)

The guard hook blocks secret files only in task sessions. On the VPS, also add deny rules
to `~/.claude/settings.json`. Claude Code enforces them itself, in every session:

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)",
      "Read(~/.ssh/**)", "Read(**/credentials*)"
    ]
  }
}
```

## Credits

Ideas from firstmate, super-board, humanlayer, pstack, shipwright and mattpocock/skills
(see DESIGN.md §10). The principle skills are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT © 2026 Lauren Tan).
