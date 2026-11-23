# orqestrai

An orchestrated software factory with human gates. Each task runs a playbook, chosen by
the agent or by you; the one playbook now, feature, is triage → plan → impl → verify →
learn → ship. The design is in [DESIGN.md](DESIGN.md).

## What you need

Claude Code, Bun, git, `gh` (logged in to GitHub) and [herdr-core](https://github.com/herdrdev/herdr-core)
(`hc`), which keeps the task sessions. Optional: a sandbox
for the task sessions (e.g. [Fence](https://github.com/fencesandbox/fence)), a second
machine.

## Install

```bash
bun add -g orqestrai                    # the orq CLI (Bun runs it)
claude plugin marketplace add saculo/orqestrai
claude plugin install orq@orqestrai     # skills, agents and the guard hook
```

Update with `bun update -g orqestrai` and `claude plugin update orq@orqestrai`.

Then, in each project's git repository, `orq init` writes `.orqestrai/config.toml`: the
base branch (`base_branch`). Optional there: `herdr_session = "meal-prep"`, the Herdr
session the project's task terminals open in, as new tabs. Only the Herdr app creates
sessions, so the session must be open with a terminal in it. Without it, or when it is not
open, a task opens in the session of the terminal `orq new` runs in, else in any session.

**The quality gate** (in verify and ship) runs the commands under `## Checks` in the
`AGENTS.md` nearest to each file the task's branch changed: the repository's own, or a
service's (`recipes/AGENTS.md`) in a repository of services. orq keeps no commands.

## Configure

Everything is optional and in one file, `~/.config/orqestrai/config.toml`:

```toml
server   = "http://orq.example:7400"    # several machines: where orq-server runs
sandbox  = "fence --"                   # task sessions start inside this command
add_dirs = ["~/shared-skills"]          # more directories for every task session

[github]
user  = "me"                                 # orq issues reads issues you opened, nobody else's
repos = { "me/my-app" = "~/Projects/my-app" } # repo → the checkout where its tasks start
```

Other keys: `model` (the task session's, default `opus`), `data` (worktrees, archive and
state, default `~/.orqestrai`), `hc` (the herdr-core command, default `hc`). `ORQ_CONFIG` names
another file. Secrets never go in this file. An
environment variable `ORQ_<KEY>` (e.g. `ORQ_SERVER`) overrides a key. A key orq does not
know is an error.

### One machine or several

- **One machine:** set nothing. orq keeps its state in a SQLite file, `~/.orqestrai/state.db`.
- **One machine, task sessions in a sandbox:** keep the state outside it. Run
  `orq-server --socket ~/.orqestrai/orq.sock` outside the sandbox and set
  `server = "~/.orqestrai/orq.sock"`. The sessions then only talk to the socket; the
  sandbox must allow Unix sockets, not writes to `~/.orqestrai`.
- **Several machines:** run **orq-server** on one of them, as a container
  (`ghcr.io/saculo/orqestrai:<version>`) or the binary from the release (`orq-server-linux-x64`):

  ```bash
  orq-server --socket /run/orq/orq.sock      # same machine: server = "/run/orq/orq.sock"
  orq-server --host 10.0.0.2 --port 7400     # another: server = "http://10.0.0.2:7400"
  ```

  and set `server` on the others. In the container the state is in
  `/home/nonroot/.orqestrai`; give it a volume (`-v orq:/home/nonroot/.orqestrai`). Over TCP the server does not authenticate callers:
  listen on a private address that only your machines reach. `--host` defaults to
  `127.0.0.1`.

### Dashboard

orq-server also serves a read-only dashboard at `/` of its TCP address: the board of tasks
by step, what waits for you on top (with the whole message), and each task's files, verify
screenshots and timeline. It works on a phone too. Give the server a TCP port (next to its
socket, if it has one) and reach it only over a private network, such as Tailscale:

```bash
orq-server --socket ~/.orqestrai/orq.sock --port 7400     # 127.0.0.1:7400
```

The task files and screenshots come from copies the CLI sends to the server whenever a step
reports (`orq new`, `orq set-state`), so they show wherever orq-server runs.

## Use

In a project's git repository:

```bash
orq new "what you want"                 # id, branch, worktree, session running /orq:task <id>
orq new --playbook feature "…"          # the same, with the playbook chosen by you
orq new --origin jira:APP-12 "…"        # linked to what it comes from, <kind>:<ref>
orq ls                                  # all tasks
orq show T-0001                         # one task, its links and its last events
orq resume T-0001                       # start its session again if it is not running (after a restart)
orq clean T-0001                        # a merged or dropped task: end its session, remove its worktree and branch
```

The sessions run the rest themselves: `orq set-state` (step, status, the question they wait
on, the playbook) and `orq create-artifact` (a task file from its template). You answer a
waiting session by typing in it. A task's PR is found by its branch.

Always start a task session with `orq new` or `orq resume`. They set `ORQ_TASK`, and the
guard hooks are active only when it is set. Each session runs in a herdr-core terminal
named after the task (`orq-t-0001`), which stays alive when nobody watches: `hc attach
orq-t-0001` in a terminal, or the Herdr app (desktop or phone, over SSH), shows it and lets
you type. Without
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

### GitHub issues (optional)

`orq issues`, on the machine of the sessions, looks at GitHub every minute (with `gh`, so
no open port): each open issue you opened in a repo of `[github] repos` that no task came
from yet becomes a task, as `orq new` in that repo's checkout. The issue's title is the
task's title, its text the request; the task's source is `github`, the issue is linked as
its origin, and orq comments on the issue with the task's id and branch. Issues by anyone
else are never read, so a public repo is fine. Every open issue of yours counts, so close
the ones you do not want as tasks before you add a repo. `gh` needs read and write on the
repo's issues.

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
`packages/cli/package.json`, `packages/server/package.json` and
`plugin/.claude-plugin/plugin.json`) releases it: the npm package `orqestrai` (the CLI),
both compiled binaries and orq-server's image.

```
packages/core/           the state and its API, shared by the CLI and the server (not published:
                         both bundle it). TypeScript, Effect 4, Bun
packages/cli/            orq, the CLI (npm `orqestrai`). Mechanics only. src/main.ts starts it;
                         templates/: task files, `orq create-artifact <id> <NAME>` writes one
packages/server/         orq-server: the state over HTTP, and the dashboard (src/dashboard/)
bin/orq                  runs the CLI from a checkout
test/                    CLI, server, guard and plugin tests (bun test)
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
packages/cli/src/guard/  `orq guard`: guards G1–G4 for task sessions (PreToolUse hook)
```

## Credits

Ideas from firstmate, super-board, humanlayer, pstack, shipwright and mattpocock/skills
(see DESIGN.md §10). The principle skills are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT © 2026 Lauren Tan).
