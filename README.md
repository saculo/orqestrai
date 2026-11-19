# orqestrai

An orchestrated software factory with human gates. Each task runs a playbook, chosen by
the agent or by you; the one playbook now, feature, is triage → plan → impl → verify →
learn → ship. The design is in [DESIGN.md](DESIGN.md).

## What you need

Claude Code, Bun, git, `gh` (logged in to GitHub) and [herdr-core](https://github.com/herdrdev/herdr-core)
(`hc`), which keeps the task sessions. Optional: Slack, a sandbox
for the task sessions (e.g. [Fence](https://github.com/fencesandbox/fence)), a second
machine.

## Install

```bash
bun add -g orqestrai                    # the orq CLI and server (Bun runs it)
claude plugin marketplace add saculo/orqestrai
claude plugin install orq@orqestrai     # skills, agents and the guard hook
```

Update with `bun update -g orqestrai` and `claude plugin update orq@orqestrai`.

Then, in each project's git repository, `orq init` writes `.orqestrai/config.toml`: the
base branch and the commands of the quality gate.

## Configure

Everything is optional and in one file, `~/.config/orqestrai/config.toml`:

```toml
server   = "http://orq.example:7400"    # several machines: where orq serve runs
sandbox  = "fence --"                   # task sessions start inside this command
add_dirs = ["~/shared-skills"]          # more directories for every task session

[slack]
user     = "U0123"
tokens   = "~/.config/orq-bridge/slack.env"
channels = { C0123 = "~/Projects/my-app" }   # channel → the checkout where its tasks start
```

Other keys: `model` (the task session's, default `opus`), `data` (worktrees, archive and
state, default `~/.orqestrai`), `hc` (the herdr-core command, default `hc`). `ORQ_CONFIG` names
another file. Secrets never go in this file; it only names the file that holds them. An
environment variable `ORQ_<KEY>` (e.g. `ORQ_SERVER`) overrides a key. A key orq does not
know is an error.

### One machine or several

- **One machine:** set nothing. orq keeps its state in a SQLite file, `~/.orqestrai/state.db`.
- **One machine, task sessions in a sandbox:** keep the state outside it. Run
  `orq serve --socket ~/.orqestrai/orq.sock` outside the sandbox (e.g. as a user service) and
  set `server = "~/.orqestrai/orq.sock"`. The sessions then only talk to the socket; the
  sandbox must allow Unix sockets, not writes to `~/.orqestrai`.
- **Several machines:** run `orq serve` on one of them, as a process or a container
  (`ghcr.io/saculo/orqestrai:<version>`):

  ```bash
  orq serve --socket /run/orq/orq.sock      # same machine: server = "/run/orq/orq.sock"
  orq serve --host 10.0.0.2 --port 7400     # another: server = "http://10.0.0.2:7400"
  ```

  and set `server` on the others. In the container the state is in
  `/home/nonroot/.orqestrai`; give it a volume (`-v orq:/home/nonroot/.orqestrai`). Over TCP the server does not authenticate callers:
  listen on a private address that only your machines reach. `--host` defaults to
  `127.0.0.1`.

### Dashboard

`orq serve` also serves a read-only dashboard at `/` of its TCP address: the board of tasks
by step, what waits for you on top (with the whole message), and each task's files, verify
screenshots and timeline. It works on a phone too. Give the server a TCP port (next to its
socket, if it has one) and reach it only over a private network, such as Tailscale:

```bash
orq serve --socket ~/.orqestrai/orq.sock --port 7400     # 127.0.0.1:7400
```

The task files and screenshots come from copies the CLI sends to the server whenever a step
reports (`orq new`, `orq state`, `orq ask`), so they show wherever `orq serve` runs.

## Use

In a project's git repository:

```bash
orq new "what you want"         # id, branch, worktree, session running /orq:task <id>
orq new --playbook feature "…"  # the same, with the playbook chosen by you
orq ls                          # all tasks
orq show T-0001                 # one task, its links and its last events
orq open T-0001                 # start the task's session again, for example after a restart
orq send T-0001 "go on"         # type a message into the task's session
```

Always start a task session with `orq new` or `orq open`. They set `ORQ_TASK`, and the
guard hooks are active only when it is set. Each session runs in a herdr-core terminal
named `orq-<id>`, which stays alive when nobody watches: `hc attach orq-T-0001` in a
terminal, or the Herdr app (desktop or phone, over SSH), shows it and lets you type. Without
`hc`, `orq new` prints the command to run.

A project's own skills, agents and hooks go in its `.claude/` as usual. Shared ones can go
in a directory of your own, given to every task session with `add_dirs`.

**Verify** needs the app running. How to start it, locally or as a preview that something
else deploys, is written in the project's `verify-<surface>` skill (DESIGN.md §5). For
web, mobile and APIs, use [e2e](https://github.com/e2e-inc/e2e): `npx e2e init` in the
project, then its `create-verification-skill` writes the skill. Its agent steps can run on
your Claude subscription (`claudeCode` from `@e2e-dev/acp`). The machine of the task
sessions needs the browser's system libraries once (`npx playwright install-deps`, as
root). The session installs the browser itself (`npx @e2e-dev/web install chromium`); in a
sandbox, allow Playwright's download hosts: `cdn.playwright.dev`,
`playwright.download.prss.microsoft.com` and `storage.googleapis.com`.

### Slack (optional)

`orq bridge`, on the machine of the sessions, connects a Slack app (Socket Mode) to them:
`@orq <request>` in a project's channel starts a task with its own thread, a session's
questions (`orq ask`) are posted there, and your replies are typed into the session. The
tokens file has `SLACK_APP_TOKEN=xapp-…` and `SLACK_BOT_TOKEN=xoxb-…` lines; hide it from
the sandbox. The app, from a manifest (api.slack.com/apps, Create New App, From a
manifest):

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

### Secret files (second lock)

The guard hook blocks secret files only in task sessions. Deny rules in
`~/.claude/settings.json` are enforced by Claude Code itself, in every session:

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

## Develop

From a checkout: `bun install`, `ln -s "$PWD/bin/orq" ~/.local/bin/orq`, and
`claude --plugin-dir ./plugin`. `bun test` runs everything. A tag `v<version>` (as in
`package.json` and `plugin/.claude-plugin/plugin.json`) releases it: the npm package, a
compiled binary and the image.

```
src/                     orq: TypeScript, Effect 4, Bun. Mechanics only. src/main.ts starts it
bin/orq                  runs src/main.ts from a checkout
test/                    CLI, server, guard and plugin tests (bun test)
templates/               task files; `orq file <id> <NAME>` writes one (built into orq)
plugin/                  the Claude Code plugin `orq`:
  skills/workflow/       task (the base: playbook, records, gates), playbook-feature,
                         triage, plan, impl, verify, learn, ship (steps), grill
                         (how they ask questions), git (branch, staging, commit, push)
  skills/modeling/       problem-class, consistency-unit, context-distilling: tools that
                         plan and grill load on signals
  skills/principles/     short principles that steps load; test-behavior has GUIDELINES.md
  agents/                researcher (neutral code research), implementer (one task, test
                         first), verifier (drives the app, never reads code), reviewer
  hooks/                 the guard hook (`orq guard`)
src/guard/               `orq guard`: guards G1–G4 for task sessions (PreToolUse hook)
```

## Credits

Ideas from firstmate, super-board, humanlayer, pstack, shipwright and mattpocock/skills
(see DESIGN.md §10). The principle skills are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT © 2026 Lauren Tan).
