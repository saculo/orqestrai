---
id: T-0003
status: draft
---

# A backlog (add a task now, start it later) and a GitHub label trigger that adds and starts a task

**Category:** feature

**Triage check:** Feature: not found. Looked for a not-started state, a start command,
automations, triggers, webhooks and a watcher in `packages/` (domain, migrations, CLI
commands, server routes, dashboard board) and DESIGN.md: none. A new task always gets its
worktree and session at once (RESEARCH.md). Out-of-scope match: none (no
`.orqestrai/out-of-scope/`; the archive holds only T-0001, unrelated).

**Current behavior:** `orq new` adds the task, makes its branch and worktree and opens its
session in one step; there is no way to add a task for later. GitHub issues reach orq only
through `orq issues`, which polls `gh` every minute for issues you authored in `[github] repos`
and starts a task for each. orq-server has no auth and no push channel; the dashboard counts
TODO tasks as running.

**Desired behavior:** (REQUEST.md items 1-6 and the Decisions below)
- `orq new "<request>"` only adds a backlog task and prints `orq start <id>`.
- `orq start <id>` makes the branch and worktree from the latest base branch, writes
  `REQUEST.md`, and opens the session in the project's Herdr space. On a started task it is
  an error that points to `orq resume`. When it fails, the task is BLOCKED with the reason.
- The dashboard shows backlog tasks in their own "Backlog" group, apart from "Running".
- A project declares its label trigger in `.orqestrai/automations/<name>.md`: front matter
  with the trigger and its filter (provider github, event issue_labeled, labels), and a
  body that is the request template. A label trigger always starts its task.
- Labelling an issue in GitHub adds one task for that issue (labelling it again adds
  nothing), comments the task id on the issue, and `orq watch` starts it. A task added while
  `orq watch` is down is started when it connects. Later issue changes do nothing.
- `orq issues` and `[github] user` are gone; `[github] repos` stays, so `orq start` finds a
  repo's checkout.

**Who sees it:** the user at the CLI (`orq new`, `orq start`, `orq watch`), on the dashboard
(the backlog), and on GitHub (labelling an issue starts a task; the issue gets the task id).
Project owners who run `orq init` (the workflow caller, the secrets to set).

**Scope:**
- The backlog: add-only `orq new`, `orq start`, the backlog on the dashboard.
- Automation files with the GitHub issue-label trigger.
- The transport: the reusable GitHub Actions workflow and the caller `orq init` writes, the
  narrow token-protected endpoint that adds a task from an issue, `orq watch`.
- Docs: the secrets to set, the Tailscale ACL for `tag:orq-ci`.
- Removal of `orq issues` and `[github] user`; DESIGN.md and the glossary updated.

**Out of scope:**
- Error-alert webhooks and any trigger other than the GitHub issue label.
- Starting tasks from the dashboard (it stays read-only).
- Auth for the rest of orq-server's API.
- Self-hosted runners, Forgejo, `pull_request_target`.
- An author filter on label triggers; an add-only (`start: false`) automation.
- A limit on concurrent sessions.

**Open decisions:** none. For plan (REQUEST.md): the server-to-watch connection, the
endpoint's shape and its token config, how `orq init` writes the workflow and the secrets to
set, the Tailscale ACL docs.

**Decisions:**
- Q1 My reading: feature, not built, no out-of-scope match; proceed on REQUEST.md's settled design, grill only behavior; transport waits for plan.
- Q2 Not started: a backlog task is status TODO with no worktree; `orq start` makes the worktree and the task stays TODO until its session sets IN PROGRESS; the dashboard shows not-started tasks as "Backlog", apart from "Running".
- Q3 One-step start: `orq new` stays add-only (no `--start`) and prints `orq start <id>`. A GitHub issue labelled `orq` still starts on its own: `orq watch` runs `orq start` for it, in the project's Herdr space (REQUEST.md 4-5).
- Q4 Watch offline: a task added with start waits in the backlog; `orq watch` starts it when it connects.
- Q5 Who can trigger: anyone who can add the label starts a task, whoever wrote the issue; risk accepted, the label is the review. No author filter now.
- Q6 Failed start: the task becomes BLOCKED with the reason as its note (repo not in `[github] repos`, git failure, space not open). Fix: `orq start` again, or `orq resume` once the worktree exists.
- Q7 Later issue changes: an edit, a close or a removed label does nothing to the task.
- Q8 Removal: `orq issues` and `[github] user` are removed. No special handling for old configs: a leftover `user` key fails as any unknown key does today (decided by the agent after the user asked why keep anything; `[github] repos` stays for `orq start`).
- Q9 Add only: no `start` field; every label trigger adds and starts its task.

**Assumptions:**
- A backlog task keeps its request in orq's state (no worktree to hold `REQUEST.md`);
  `orq start` writes `REQUEST.md` into the new worktree.
- A backlog task is dropped with `orq set-state <id> triage DROPPED`; `orq clean` then has no
  worktree or branch to remove.
- `orq start` runs on the sessions' machine; `orq new` may run anywhere that reaches the state.
