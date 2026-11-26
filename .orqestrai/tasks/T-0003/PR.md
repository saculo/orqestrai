<!-- orqestrai T-0003. Written by ship from the task files in .orqestrai/tasks/T-0003/. -->

## What and why
Before, `orq new` added a task and made its worktree and session in one step, and GitHub reached orq only through the `orq issues` poller. Now there is a backlog:
- `orq new` only adds a task, and `orq start <id>` starts it.
- A project can declare a GitHub label trigger: labelling an issue adds a task and starts it on the sessions' machine.
- The trigger path: a GitHub Actions job joins the tailnet as `tag:orq-ci` and calls a token-protected port on orq-server. `orq watch` keeps a stream to the server open and runs `orq start` for each task the server sends.
- `orq issues` and `[github] user` are removed.

## Acceptance criteria
- [x] **AC1** `orq new` adds a backlog task (TODO, no worktree, branch or session) and prints `orq start <id>`. V1 `VERIFIED`: B1, B2 pass in `bun test`.
- [x] **AC2** `orq start` fetches `origin <base>`, branches from `origin/<base>` (the local base without an origin), writes `REQUEST.md` and opens the session in the project's Herdr space. V1 `VERIFIED`: B3, B4.
- [x] **AC3** `orq start` on a started task fails and points to `orq resume`. V1 `VERIFIED`: B5, and two `orq start` at once start the task once.
- [x] **AC4** A failed start leaves the task BLOCKED with the reason; after the fix, `orq start` (or `orq resume`) works. V1 `VERIFIED`: B6, B7, B8, and a git failure after the claim.
- [x] **AC5** The dashboard shows not-started tasks under "Backlog", not "Running". V1 `VERIFIED`: B9 (how it looks: V3, below).
- [x] **AC6** `orq trigger github` renders the matching automation and calls the trigger; another label does nothing; a bad file fails and names the file. V1 `VERIFIED`: B10, B11, B12.
- [x] **AC7** The trigger port (`--trigger-port`, `ORQ_TRIGGER_TOKEN`) adds one task per issue. A bad token gets 401, and no other route answers on that port. Only an `owner/name` repo with an issue URL in that repo is accepted. V1 `VERIFIED`: B13 to B16, plus the round 2 test.
- [x] **AC8** `orq watch` starts the waiting GitHub tasks on connect, then each new one. It goes on after a failure, reconnects, never starts a task twice, and needs a server. V1 `VERIFIED`: B17 to B21.
- [x] **AC9** `orq issues` and `[github] user` are gone. V1 `VERIFIED`: B22.
- [x] **AC10** The reusable workflow `issue-labeled.yml`, the README, DESIGN.md, GLOSSARY.md and ADR-0002. V2 `VERIFIED`: actionlint exit 0, and the docs are in the diff.

## For you to check
- [ ] **V3 (AC5):** open the dashboard while a backlog task exists (`orq new "check"`). It is under "Backlog", not "Running".
- [ ] **V4 (AC6 to AC8, AC10):** in a test repo:
  1. Add the caller workflow and an automation file (README, "GitHub trigger"), and set the secrets and the variable.
  2. Start orq-server with `--trigger-port` and `ORQ_TRIGGER_TOKEN`, and run `orq watch` on the sessions' machine.
  3. Add the `orq` label to an issue: a comment with the task id appears, and a tab for the task opens in the project's Herdr space.
  4. Add the label again: nothing new happens.

  This needs a release that ships `orq trigger github`: set the README's example version (`0.11.0`) to it.

## Verify
- Rounds: 2.
- Quality gate: types pass, lint pass, tests pass (191 with `--timeout 60000`).
- Review: 2 blocking findings, both fixed in round 2:
  - `orq clean` failed on a dropped GitHub task that never started.
  - The trigger accepted any `repo`, so a token holder could name a local folder and get around `[github] repos`.

## Open findings (not blocking)
- Many CLI tests now run `orq new` and then `orq start` (two processes). On a loaded 1-CPU machine more of them need `--timeout 60000`.
- The round 2 clean test runs about 15 processes in one test. It could be split later.

## Learn
- **L1** Glossary: "Task repo", the GitHub name before start and the checkout path after (`GLOSSARY.md`).
- **L2** Out of scope: `orq init` does not write the workflow caller (`.orqestrai/out-of-scope/orq-init-writes-workflow.md`).
- **L3, L4** Testing notes: the cause of the timeouts, and how to test long-running commands (`.orqestrai/testing.md`).

## Decisions
- A not-started task has a null worktree; migration 0004 rebuilds `tasks`, and foreign keys are switched on after the migrations so the rebuild keeps events, links and files.
- A start claims the task first (`Db.start`). A failure after the claim undoes it (`Db.unstart`) and blocks the task.
- The trigger has its own port, so the Tailscale ACL can let CI reach only that route. The server pushes starts to `orq watch` over SSE (`GET /starts`) and never runs a command (ADR-0002).
- Every label trigger starts its task (no `start: false`). Anyone who can add the label can start a task, and the label is the review.

## Risk
High:
- It opens a new way in from GitHub-hosted runners, over Tailscale, to a token-protected port.
- Issue text from strangers becomes an agent's request (accepted: the label is the review).
- A migration rebuilds the `tasks` table, tested on a database with existing tasks.
- It changes `orq new`.

Blast radius: the state database, every task start, and the server's exposure.
