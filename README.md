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
space the project's task terminals open in, as new tabs. Without it, the space is named like
the repository's directory. A task session starts only in that space, never in another one.
Only the Herdr app creates spaces, so the space must be open with a terminal in it. If it is
not, `orq start` keeps the task and its worktree, starts no session, and names the
space; open it in the Herdr app, then run `orq resume <id>`.

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
repos = { "me/my-app" = "~/Projects/my-app" } # repo → the checkout where orq watch starts its tasks
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
reports (`orq new`, `orq start`, `orq set-state`), so they show wherever orq-server runs.

## Use

In a project's git repository:

```bash
orq new "what you want"                 # adds a task to the backlog; prints its id
orq new --playbook feature "…"          # the same, with the playbook chosen by you
orq new --origin jira:APP-12 "…"        # linked to what it comes from, <kind>:<ref>
orq start T-0001                        # branch, worktree, session running /orq:task <id>
orq ls                                  # all tasks
orq show T-0001                         # one task, its links and its last events
orq resume T-0001                       # start its session again if it is not running (after a restart)
orq clean T-0001                        # a merged or dropped task: end its session, remove its worktree and branch
```

The sessions run the rest themselves: `orq set-state` (step, status, the question they wait
on, the playbook) and `orq create-artifact` (a task file from its template). You answer a
waiting session by typing in it. A task's PR is found by its branch.

`orq new` only adds the task: it is in the backlog (status TODO, no branch, no worktree, no
session), and the dashboard shows it there. `orq start` fetches `origin/<base branch>`,
branches from it (from the local base branch when there is no origin), writes `REQUEST.md`
and opens the session. A task is started once; on a started task `orq start` fails and points
to `orq resume`. When the start fails, the task is BLOCKED with the reason; if the Herdr space
is not open, the worktree stays and `orq resume` finishes it.

Always start a task session with `orq start` or `orq resume`. They set `ORQ_TASK`, and the
guard hooks are active only when it is set. Each session runs in a herdr-core terminal
named after the task (`orq-t-0001`), which stays alive when nobody watches: `hc attach
orq-t-0001` in a terminal, or the Herdr app (desktop or phone, over SSH), shows it and lets
you type. Without
`hc`, `orq start` prints the command to run.

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

### GitHub trigger (optional)

A label on a GitHub issue can add a task and start it. The server never runs a command and
nothing from GitHub reaches your machines directly:

```
issue labeled → Actions job → Tailscale → orq-server's trigger port → /starts stream → orq watch → orq start
```

**Who can start a task.** Every label trigger starts its task, and anyone who can add the
label can start one. The label is the review. The issue's text becomes the agent's request,
so label only issues you have read, and keep the right to label to people you trust.

**1. The server.** Give orq-server a trigger port of its own and a token in its environment.
The port serves only `POST /github/issues`, with that bearer token:

```bash
export ORQ_TRIGGER_TOKEN=$(openssl rand -hex 32)
orq-server --socket ~/.orqestrai/orq.sock --port 7400 --trigger-port 7401
```

Put the token only in the server's environment and in the repo's secrets.

**2. Tailscale.** The Actions job joins your tailnet as `tag:orq-ci` and reaches only the
trigger port. In the tailnet policy file (the server's machine has its own tag, here
`tag:orq-server`):

```json
{
  "tagOwners": {
    "tag:orq-ci": ["autogroup:admin"],
    "tag:orq-server": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["tag:orq-ci"], "dst": ["tag:orq-server"], "ip": ["tcp:7401"] }
  ]
}
```

Then create an OAuth client (Settings, OAuth clients) with the scope `auth_keys` (write)
and the tag `tag:orq-ci`. Its nodes are ephemeral.

**3. The repo's secrets and variables.**

```bash
gh secret set TS_OAUTH_CLIENT_ID --repo me/my-app
gh secret set TS_OAUTH_SECRET --repo me/my-app
gh secret set ORQ_TRIGGER_TOKEN --repo me/my-app      # the same token as the server's
gh variable set ORQ_TRIGGER_URL --repo me/my-app --body "http://orq-server:7401"
```

**4. The caller**, `.github/workflows/orq.yml` in the project. It uses the reusable workflow
of this repository, pinned to a release tag; `orq-version` is the npm version of `orqestrai`
it runs (pin it too):

```yaml
name: orq
on:
  issues:
    types: [labeled]
permissions: {}
jobs:
  orq:
    if: github.event.label.name == 'orq'      # optional: skips the runs of other labels
    permissions:
      contents: read
      issues: write                           # the comment with the task id
    uses: saculo/orqestrai/.github/workflows/issue-labeled.yml@v0.11.0
    with:
      orq-version: 0.11.0
      trigger-url: ${{ vars.ORQ_TRIGGER_URL }}
    secrets:
      TS_OAUTH_CLIENT_ID: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      TS_OAUTH_SECRET: ${{ secrets.TS_OAUTH_SECRET }}
      ORQ_TRIGGER_TOKEN: ${{ secrets.ORQ_TRIGGER_TOKEN }}
```

Never use `pull_request_target` for it. The job runs `orq trigger github` from npm in a
checkout of the default branch, and comments the task id on the issue with the job's own
`GITHUB_TOKEN`.

**5. An automation file**, `.orqestrai/automations/<name>.md` in the project (committed to
the default branch). The front matter says when it fires; the body is the request. The
placeholders are `{{title}}`, `{{body}}`, `{{url}}`, `{{number}}` and `{{repo}}`:

```markdown
---
provider: github
event: issue_labeled
labels: [orq]
---
Fix GitHub issue {{repo}}#{{number}}: {{title}}

{{body}}

Issue: {{url}}
```

A label that no automation names does nothing. A bad file fails the job with its name and the
reason. The first file by name that names the label is used.

**6. `orq watch`**, on the sessions' machine, outside the sandbox. It needs `server` (or
`ORQ_SERVER`) and the project's checkout in `[github] repos`. It keeps the server's `/starts`
stream open, runs `orq start` for each GitHub task (the waiting ones when it connects, then
each new one) and reconnects when the stream drops:

```bash
orq watch
```

A task from an issue that was already added is not added twice: the job prints
`<id> already there` and adds no comment.

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
