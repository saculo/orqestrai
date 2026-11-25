---
id: T-0003
---

# Research: the task lifecycle, orq issues, the server and the dashboard

Questions were asked without the request, so the findings describe the code as it is.

## `orq new` writes the row, the worktree and the session in one go; `orq resume` only reopens the session

**Question:** What does `orq new` do step by step, and how does `orq resume` differ?

`startTask` resolves the base branch, writes the task row (step `triage`, status `TODO` from
the column defaults), runs `git worktree add -b orq/<id>-<slug>` (removing the row if that
fails), writes `REQUEST.md` in the worktree, links the origin, syncs the task files, then
opens the session. A space that is not open keeps the row and worktree but opens no session.
`orq resume` writes nothing: it reads the task, fails when the worktree is gone, and calls
`openSession` (which trusts the worktree again).

**Evidence:**
- `packages/cli/src/task.ts:33`: `db.create`, the first side effect
- `packages/cli/src/task.ts:44`: `addWorktree`, with `db.remove` on failure
- `packages/cli/src/task.ts:47`: `REQUEST.md` is written into the worktree
- `packages/cli/src/task.ts:48`: origin link, after the worktree
- `packages/cli/src/task.ts:51`: `openSession`, `SpaceNotOpen` becomes `spaceNotOpen: true`
- `packages/cli/src/herdr.ts` `openSession`: trust, `hc ls`, reuse a running `orq-t-NNNN`, else `hc run --bg --outlive-parent` in the project's space
- `packages/cli/src/cli.ts` `resume`: `db.get`, worktree check, `openSession`

**Tests:** `test/orq.test.ts` (new, origin, resume), `test/herdr.test.ts` (sessions, space not open, trust).

## TODO is only a column default; no code enforces transitions

**Question:** What steps and statuses exist, what sets TODO, and where are transitions enforced?

Steps: triage, plan, impl, verify, learn, ship. Statuses: TODO, IN PROGRESS, WAITING FOR ME,
BLOCKED, DROPPED, MERGED. A new row is triage/TODO by default; nothing writes TODO explicitly.
`setState` writes any valid pair. Today a TODO task always has a worktree (and usually a
session that has not yet set IN PROGRESS). No status means "not started".

**Evidence:**
- `packages/core/src/domain.ts`: `STEPS`, `STATUSES`, `SOURCES = cli, slack, github`
- `packages/core/src/migrations/0001_init.ts`: `tasks` with defaults and CHECKs; `task_links` UNIQUE `(task_id, kind, ref)`
- `packages/core/src/migrations/0003_source.ts`: `source` column, default `cli`
- `packages/core/src/db.ts` `setState`: unconditional update plus an event
- `packages/cli/src/clean.ts:56`: clean refuses anything but MERGED or DROPPED; it handles a missing worktree

**Tests:** `test/orq.test.ts` (set-state, a new task is triage/TODO), `test/clean.test.ts`.

## `orq issues` polls `gh` every minute and dedupes on the `gh-issue` link

**Question:** How does `orq issues` work, and where is `[github] repos` read?

A forever loop: for each `[github] repos` entry it lists open issues authored by
`[github] user` (max 100), skips any issue with a `gh-issue:<url>` link, and calls
`startTask` with the issue's title, a request of title + body + URL, source `github`. It then
comments the id, status and branch. Dedupe is only the `findLink` check (no global
uniqueness on `(kind, ref)`). `[github]` is mapped by `settings.ts` to `ORQ_GITHUB_USER` and
`ORQ_GITHUB_REPOS`; `user` is used only by `orq issues`.

**Evidence:**
- `packages/cli/src/issues.ts:80`: `startTask(checkout, requestOf(issue), …)`
- `packages/cli/src/issues.ts:108`: `findLink(ISSUE_LINK, issue.url)` skip
- `packages/cli/src/issues.ts:116-127`: the loop and its interval
- `packages/core/src/settings.ts`: `[github]` keys `user`, `repos`; unknown keys are errors
- `packages/core/src/db.ts` `findLink`: the newest task with that link

**Tests:** `test/issues.test.ts`, `test/config.test.ts` (`[github]` mapping).

## The CLI is local SQLite or the server's HTTP API, chosen by `ORQ_SERVER`

**Question:** How does the CLI reach orq-server, and what are its endpoints?

`State` is `Remote` (Effect `HttpApiClient`, a Unix socket or a URL) when `ORQ_SERVER` is set,
else `Direct` on `<data>/state.db`. API: tasks CRUD, state, events, links, `GET /links`
(findLink), playbook, now, sums, files, copy. Dashboard: `/`, `/board`, task files and
evidence, all GET.

**Evidence:**
- `packages/core/src/state.ts:15`: `ORQ_SERVER` selects Remote
- `packages/core/src/api.ts`: `OrqApi` groups
- `packages/core/src/remote.ts`: socket vs URL, error mapping
- `packages/server/src/server.ts`: handlers are one-line calls into `Db`

**Tests:** `test/remote.test.ts`, `test/server.ts`.

## orq-server has no auth, no streaming, and listens on a socket and/or TCP

**Question:** How is orq-server built, configured and deployed?

Effect `HttpApi` on `BunHttpServer`; flags `--socket`, `--port`, `--host` (default
127.0.0.1). No token, no Authorization handling, no SSE or websockets: request/response only.
Image: distroless, `--host 0.0.0.0 --port 7400`. DESIGN.md §4: the server only touches its
database and never runs a command; over TCP "put it where only your machines reach it".

**Evidence:**
- `packages/server/src/server.ts`: routes and flags
- `Dockerfile`: the image's CMD
- `DESIGN.md` §4 Topology, Server and clients, §6 Security

**Tests:** `test/remote.test.ts` (TCP and socket servers).

## The dashboard is read-only, polls `/board` every 5 s, and counts TODO as running

**Question:** How does the dashboard list tasks?

`/board` returns all tasks with notes, waiting messages and links. `buildBoard` filters by
project, hides finished tasks after 3 days, and splits: needs you (WAITING FOR ME, BLOCKED),
running (everything else unfinished, TODO included), a column per step, done.

**Evidence:**
- `packages/server/src/dashboard/board.ts:33`: `isRunning` = not waiting and not finished
- `packages/server/src/dashboard/hooks.ts`: `POLL_MS = 5000`
- `packages/server/src/dashboard/tasks.ts`: the issue shown from the `gh-issue` link

**Tests:** `test/dashboard-view.test.ts`, `test/dashboard.test.ts`.

## `orq init` writes only `.orqestrai/config.toml`

**Question:** What does `orq init` write into a project?

Only `.orqestrai/config.toml` with `base_branch`, and only when it is missing. Nothing in
`.claude/` or `.github/`.

**Evidence:**
- `packages/cli/src/init.ts` `install`
- `packages/cli/src/cli.ts` `init`

**Tests:** `test/init.test.ts`.

## Open

- What the plugin skills do with a TODO task was not traced (they set IN PROGRESS at step start).
