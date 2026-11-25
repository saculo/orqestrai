---
id: T-0003
status: draft
risk: high
---

# A backlog (orq new adds, orq start starts) and a GitHub label trigger (Actions → token endpoint → orq watch)

## Open decisions
none

## Decisions
- Q11 Watch connection: the user asked why poll and not a push; asked again as Q16.
- Q12 Endpoint port: yes ("probably"): the trigger endpoint has its own port, `orq-server --trigger-port`; the ACL lets `tag:orq-ci` reach only that port. Taken as yes; the user may still change it at the SPEC gate.
- Q13 Template: the job runs `orq trigger github` (npm `orqestrai`, pinned version) in the project's checkout; it reads the automations, matches the label, renders the request and posts it with the token.
- Q14 Init: no. `orq init` stays as it is; the user writes the caller workflow, the automation file and the secrets by hand from the docs (README shows the caller and the `gh secret set` lines). This replaces REQUEST.md item 4's "a short caller that orq init writes".
- Q16 Watch connection: (a) an open line. `orq watch` dials the server and keeps one stream open (SSE); the server sends the id of each GitHub task to start, all not-started ones first on every connect, then each new one as it is added.
- Q17 Seams: yes (below).
- Q15 Latest base: `orq start` fetches `origin <base>` and branches from `origin/<base>`; the local `<base>` only when there is no `origin`.
Agent decisions (reversible, from the brief and the code):
- A not-started task has no worktree: the worktree column becomes nullable; started = has a
  worktree. The branch name is still given at add (`orq/<id>-<slug>`, machine-independent);
  the worktree path is given at start (it depends on the sessions' machine's data folder).
- A GitHub-added task has no checkout until it starts: its `repo` is the GitHub name
  (`saculo/meal-prep`) until then; `orq start` resolves the checkout from `[github] repos` and
  records the checkout path as `repo`. Because the dashboard and the archive already work by
  the repo's last folder name, which is the same in both forms; no new column.
- The request of a backlog task is its `REQUEST.md` in the task's stored files (the copy the
  dashboard already reads); `orq start` writes it into the new worktree.
- `orq watch` starts every not-started task that came from GitHub (source `github`) and is
  TODO; a BLOCKED one waits for the user (`orq start`). No extra "start" flag: every label
  trigger starts its task (Q9).
- Starting claims the task in one transaction (it fails when the task is already started),
  so two `orq watch` processes, or `orq watch` and the user, never start a task twice.
- Adding from an issue checks for the `gh-issue` link and adds in one transaction, so two
  label events at once add one task.
- The endpoint is off when the server has no token: `--trigger-port` without
  `ORQ_TRIGGER_TOKEN` in the server's environment is an error at start (secrets are never in
  the config file). The token is compared in constant time.
- `orq trigger github` reads `GITHUB_EVENT_PATH` (the Actions event file), `ORQ_TRIGGER_URL`
  and `ORQ_TRIGGER_TOKEN`; it prints the task id, and the workflow comments it with `gh`.
- Automation file: front matter `provider: github`, `event: issue_labeled`, `labels: [..]`;
  body with `{{title}}`, `{{body}}`, `{{url}}`, `{{number}}`, `{{repo}}`. An unknown key or
  placeholder is an error. When several files match a label, the first by file name wins.
- `orq watch` needs a server (`ORQ_SERVER`); without one it fails with a message. It
  reconnects after the line drops, with a short wait.
- The start stream is a plain route next to `/board` (not in the typed API), on the main port.
- `orq resume` on a not-started task fails and points to `orq start`; `orq clean` of a dropped
  task that never started removes nothing and still archives what is on the server.

## Acceptance criteria
- **AC1** `orq new "<request>"` adds a backlog task: status TODO, step triage, no worktree, no
  branch in git, no session; it prints the id and `orq start <id>`. `orq show` and `orq ls`
  show it.
- **AC2** `orq start <id>` fetches `origin <base>`, makes the task's branch and worktree from
  `origin/<base>` (the local base when there is no origin), writes `REQUEST.md` with the
  request, and opens the session in the project's Herdr space.
- **AC3** `orq start` on a started task fails and names `orq resume <id>`; nothing changes.
- **AC4** When `orq start` fails (no checkout for the GitHub repo in `[github] repos`, a git
  failure, the space not open), the task is BLOCKED with the reason as its note. Space not
  open: the worktree stays and the note says to open the space and run `orq resume <id>`.
  After the fix, `orq start` (or `orq resume`) starts it.
- **AC5** The dashboard shows not-started tasks in a "Backlog" group, not in "Running".
- **AC6** `orq trigger github`, given an `issues` `labeled` event whose label matches an
  automation in `.orqestrai/automations/*.md`, sends the rendered request, the repo and the
  issue to the trigger endpoint and prints the task id. A label no automation names does
  nothing and exits 0. A bad automation file fails with the file and the reason.
- **AC7** The trigger endpoint, on `orq-server --trigger-port`, with the right bearer token,
  adds one backlog task per issue: source github, origin `gh-issue:<url>`, the repo's GitHub
  name; the same issue again returns the same id and adds nothing. A missing or wrong token
  is refused (401) and adds nothing. No other route answers on that port. `--trigger-port`
  without `ORQ_TRIGGER_TOKEN` does not start.
- **AC8** `orq watch` keeps one stream open to the server and starts each not-started TODO
  task from GitHub: those waiting when it connects, then each new one as it is added. A
  failed start leaves the task BLOCKED (AC4) and watch goes on. It reconnects after the
  server goes away and comes back. Without `ORQ_SERVER` it fails with a message.
- **AC9** `orq issues` and `[github] user` are gone (`orq issues` is an unknown command; a
  `user` key is an unknown key).
- **AC10** The orqestrai repo has a reusable workflow for `issues: labeled` on GitHub-hosted
  runners: it joins the tailnet with tailscale/github-action (OAuth client, ephemeral,
  `tag:orq-ci`), runs `orq trigger github` from npm at a pinned version, and comments the
  task id on the issue with its own `GITHUB_TOKEN`; actions pinned by SHA, least
  permissions, never `pull_request_target`; it passes actionlint. README shows the caller,
  an automation file, the secrets and variables to set (`gh secret set`), the server flags and
  the Tailscale ACL. DESIGN.md and GLOSSARY.md describe the backlog, start, automations,
  trigger and watch.

## Operations
| Operation | Class | Why |
|-----------|-------|-----|
| `orq new` (add) | CRUD | a row and its stored request, nothing else |
| `orq start` | contention + integration | claim the task once (two starters), then git and hc |
| add from issue (endpoint) | contention + integration | one task per issue under concurrent label events; an outside caller with a token |
| `orq trigger github` | transformation + integration | event file + automation → request; one HTTP call |
| start stream | integration | the server tells a remote watcher; catch-up on connect |
| `orq watch` | integration | a long-running client of the stream that runs start |
| dashboard backlog | transformation & presentation | a new group from the task list |

## Seams
- `orq <command>` as a process (`test/orq.ts`, fake `hc` via `ORQ_HC`, temp git repos with an
  `origin`, `test/server.ts`): AC1-AC4, AC6, AC8, AC9.
- orq-server's HTTP on the trigger port and the start stream route: AC7, and the stream part
  of AC8.
- `buildBoard` (`packages/server/src/dashboard/board.ts`): AC5.

## Behaviors
- **B1 (AC1)** `orq new` adds a backlog task. Given a git repo. When `orq new "fix x"`. Then it
  prints the id and `orq start <id>`; `orq show` gives TODO/triage and no worktree; no
  branch exists in git; the fake hc got no `run`. Level: integration. Seam: CLI. Pattern: none.
- **B2 (AC1)** The request is kept. Given a backlog task added with `orq new "fix x"`. When
  `orq start`. Then the worktree's `REQUEST.md` holds "fix x". Level: integration. Seam: CLI.
- **B3 (AC2)** Start branches from the latest base. Given a repo whose `origin` has a commit
  the local base lacks, and a backlog task. When `orq start <id>`. Then the worktree exists,
  its HEAD contains origin's commit, and the fake hc ran the session in the project's space.
  Level: integration. Seam: CLI.
- **B4 (AC2)** No origin: start uses the local base. Level: integration. Seam: CLI.
- **B5 (AC3)** Start twice. Given a started task. When `orq start <id>` again. Then it exits
  non-zero naming `orq resume <id>`, and the fake hc got no second `run`. Level:
  integration. Seam: CLI.
- **B6 (AC4)** No checkout. Given a GitHub backlog task (added through the endpoint) for a repo
  not in `ORQ_GITHUB_REPOS`. When `orq start`. Then it exits non-zero; `orq show` gives BLOCKED
  with a note naming the repo and `[github] repos`. After adding the repo, `orq start` starts
  it. Level: integration. Seam: CLI + test server.
- **B7 (AC4)** Space not open. Given a backlog task and an hc with no terminal in the space.
  When `orq start`. Then the worktree exists, the task is BLOCKED with a note naming the space
  and `orq resume <id>`; `orq resume` after opening the space starts the session. Level:
  integration. Seam: CLI.
- **B8 (AC4)** `orq resume` on a not-started task fails and names `orq start`. Level:
  integration. Seam: CLI.
- **B9 (AC5)** Backlog group. Given tasks: TODO without worktree, TODO with worktree, IN
  PROGRESS. When `buildBoard`. Then the first is in `backlog` only, the others in `running`.
  Level: unit. Seam: `buildBoard`.
- **B10 (AC6)** Trigger sends a matching label. Given a checkout with
  `.orqestrai/automations/issue.md` (labels [orq]), an event file labelled `orq`, and a test
  server with a trigger port and token. When `orq trigger github`. Then it prints an id, and
  that task's `REQUEST.md` copy is the rendered template. Level: integration. Seam: CLI +
  test server.
- **B11 (AC6)** Other label: exits 0, prints that no automation matched, no task. Level:
  integration. Seam: CLI.
- **B12 (AC6)** Bad automation (unknown key, unknown placeholder, bad front matter): exits
  non-zero naming the file. Level: integration. Seam: CLI.
- **B13 (AC7)** One task per issue. When the endpoint gets the same issue twice (also two at
  once). Then both answers carry the same id; `orq ls` shows one task, source github, with
  the `gh-issue` origin. Level: integration. Seam: HTTP.
- **B14 (AC7)** Token. A request without a token, or with a wrong one, gets 401 and adds
  nothing. Level: integration. Seam: HTTP.
- **B15 (AC7)** Only one route. `GET /tasks`, `/board` and `/` on the trigger port get 404; the
  main port has no trigger route. Level: integration. Seam: HTTP.
- **B16 (AC7)** `orq-server --trigger-port` without `ORQ_TRIGGER_TOKEN` exits non-zero with a
  message. Level: integration. Seam: server process.
- **B17 (AC8)** Watch catches up and follows. Given a test server with one GitHub backlog task
  and a repo in `ORQ_GITHUB_REPOS`. When `orq watch` runs, then a second issue is triggered.
  Then both tasks get a worktree and a session (fake hc), the first before the second was
  added. A CLI backlog task (source cli) is not started. Level: integration. Seam: CLI + test
  server. Pattern: long-running process (wait on observable state with a deadline, then kill).
- **B18 (AC8)** Watch goes on. Given a GitHub task whose repo has no checkout and another that
  has one. When `orq watch`. Then the first is BLOCKED, the second started. Level:
  integration. Seam: CLI + test server. Pattern: long-running process.
- **B19 (AC8)** Reconnect. Given `orq watch` running. When the server is stopped and started
  again on the same socket and an issue is triggered. Then its task starts. Level:
  integration. Seam: CLI + test server. Pattern: long-running process.
- **B20 (AC8)** Two watchers start a task once: the fake hc logs one `run` per task. Level:
  integration. Seam: CLI + test server. Pattern: concurrency.
- **B21 (AC8)** `orq watch` without `ORQ_SERVER` fails with a message. Level: integration.
- **B22 (AC9)** `orq issues` is an unknown command; a config with `[github] user` fails as an
  unknown key. Level: integration. Seam: CLI.

## Design
- Migration 0004 rebuilds `tasks` with `worktree` nullable (SQLite cannot drop NOT NULL);
  `Task.worktree` becomes `string | null`. Started = worktree not null.
- `Db` gets `addFromIssue` (find the `gh-issue` link and create, in one transaction) and
  `start` (set repo and worktree only where worktree is null; fails when already set). The
  server's notifier publishes an added GitHub task to the open start streams.
- `startTask` splits in two: `addTask` (row, stored REQUEST.md, origin link) and `startTask`
  (resolve checkout, claim, fetch, worktree, REQUEST.md, session; BLOCKED on failure).
  `orq start` and `orq watch` share `startTask`.
- The trigger endpoint is its own small router served only on the trigger port; the payload is
  `{repo, issue: {url, number, title}, request}`, the answer `{id, added}`.
- New modules stay under ~150 lines each: `automations.ts` (parse and render), `trigger.ts`
  (the command), `watch.ts`, server `trigger.ts` and `starts.ts`.
- The reusable workflow lives at `.github/workflows/issue-labeled.yml` (`on: workflow_call`);
  the caller in a project is `on: issues: types: [labeled]` → `uses: saculo/orqestrai/...@v<version>`
  with `secrets: inherit` replaced by named secrets.
- ADR-0002: the GitHub trigger goes through Actions and Tailscale to a token-protected port,
  and the server pushes starts to `orq watch` (hard to reverse, surprising without context).

## Tasks
### Wave 1
- **W1.1** Not-started tasks in the state: migration 0004, `Task.worktree` nullable, `Db.start`,
  `Db.addFromIssue`, the API and remote client for both; every reader of `worktree` copes
  with null (`files.ts`, `clean.ts`, `resume`, dashboard). Touches: `packages/core/src/*`,
  `packages/server/src/server.ts`, `packages/cli/src/{files,clean}.ts`, dashboard readers.
  Serves: AC1, AC7. Tests: existing suite stays green; B8.

### Wave 2
- **W2.1** `orq new` adds only; `orq start`; fetch the latest base; BLOCKED on failure.
  Touches: `packages/cli/src/{task,cli,git}.ts`, `test/orq.test.ts`, `test/herdr.test.ts`.
  Serves: AC1-AC4. Tests: B1-B8.
- **W2.2** The Backlog group on the dashboard. Touches: `packages/server/src/dashboard/board.ts`,
  `components/` (a backlog list), `test/dashboard-view.test.ts`. Serves: AC5. Tests: B9.
- **W2.3** The trigger endpoint on `--trigger-port` with the token. Touches:
  `packages/server/src/{server,trigger}.ts`, `test/server.ts`, a new `test/trigger.test.ts`.
  Serves: AC7. Tests: B13-B16.

### Wave 3
- **W3.1** `orq trigger github` and automation files. Touches: `packages/cli/src/{automations,trigger,cli}.ts`,
  a new `test/automations.test.ts`. Serves: AC6. Tests: B10-B12.
- **W3.2** The start stream and its notifier. Touches: `packages/server/src/{starts,server}.ts`,
  `test/trigger.test.ts`. Serves: AC8. Tests: the stream part of B17 (catch-up and push, at HTTP).

### Wave 4
- **W4.1** `orq watch`. Touches: `packages/cli/src/{watch,cli}.ts`, a new `test/watch.test.ts`.
  Serves: AC8. Tests: B17-B21.
- **W4.2** The reusable workflow and the docs: `.github/workflows/issue-labeled.yml`, CI's
  actionlint covering it, README, DESIGN.md (§4 CLI table, Sessions, GitHub issues → GitHub
  trigger, Security), GLOSSARY.md (Automation, Trigger), ADR-0002, the plugin's git skill (`orq start`, not `orq new`, makes the branch and worktree). Serves: AC10. Tests: actionlint.

### Wave 5
- **W5.1** Remove `orq issues` and `[github] user`. Touches: `packages/cli/src/{issues,cli}.ts`,
  `packages/core/src/settings.ts`, `test/issues.test.ts` (deleted, its useful cases moved),
  `test/config.test.ts`. Serves: AC9. Tests: B22.

## Verification plan
| Check | Claim | Surface | Kind | How (what a user does and sees) | Evidence |
|-------|-------|---------|------|---------------------------------|----------|
| V1 | AC1-AC9 | cli, api | integration (impl) | the behavior tests B1-B22 run in `bun test` | the quality gate's test run |
| V2 | AC10 | repo | integration (impl) | actionlint passes on the workflow; read README, DESIGN.md and the ADR | CI run; the diff |
| V3 | AC5 | web | manual | open the dashboard with a backlog task: it is under "Backlog", not "Running" | the user, at the PR: no verify-web skill, and how it looks is a person's call |
| V4 | AC6-AC8, AC10 | GitHub + Tailscale + Herdr | manual | with the secrets set and `orq watch` running, add the `orq` label to an issue in a test repo: a comment with the task id appears, and a tab for the task opens in the project's Herdr space; label it again: nothing new | the user, at the PR: an agent here cannot reach GitHub, Tailscale or the Herdr app |

## Risk
high: a new way in from the internet (GitHub-hosted runners via Tailscale) to a token-protected
port, issue text from strangers becoming an agent's request (accepted, Q5), a table rebuild
migration of `tasks`, and a change to `orq new` that every user and skill relies on. Blast
radius: the state database (migration), every task start, the server's exposure. Priority:
the backlog and the label trigger replace `orq issues` and are the next way of working.

## Assumptions
- Effect 4's HTTP server streams a response body (SSE) on Bun, over a socket and TCP.
- `tailscale/github-action` with an OAuth client and `tag:orq-ci` gives an ephemeral node
  that reaches the server by its tailnet name.
- The published npm `orqestrai` at the pinned version contains `orq trigger github`, so the
  workflow works only from the release that ships this change.
- `orq new` from inside a task session (skills) is not used today to start work; nothing in
  `plugin/` calls `orq new` (checked: only the git skill names it, as text, and W4.2 updates it).

## Impl notes
