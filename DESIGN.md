# orqestrai — design v1

Status: draft for review, 2026-11-01. Mark it up: cross out, add, ask.
Source of the ideas: `orqestrai.md`, and the comparison of super-board, humanlayer, pstack,
firstmate, shipwright and mattpocock/skills (see §10).

## 1. Principles

1. **YAGNI.** A feature goes in only when a real run needs it.
2. **The LLM orchestrates. Scripts do the mechanics.** The workflow lives in skills, not in
   code. Small scripts do what must be exact: worktree, state, messages, PR.
3. **Guardrails, not code paths.** Agents get freedom. Hooks and permissions say what they
   must not do.
4. **Escalate only for decisions.** Progress, retries and internal mechanics are not news.
5. **Independence by context.** A checker starts with a fresh context, does not read the
   builder's summary, and uses a different model where possible.
6. **Size budget.** Each skill at most ~150 lines. The orchestrating skill at most ~200
   lines. A change that crosses the budget must remove or move text first.

### Principle skills

Short skills (`skills/principle-*`, adapted from pstack, MIT). Each step skill names the
ones it loads, so an agent loads only what its step needs.

| Principle                    | Loaded by                     |
|------------------------------|-------------------------------|
| model-the-domain (+ glossary)| triage, plan, impl            |
| fix-root-causes              | triage (bugs), impl           |
| smallest-change (YAGNI)      | plan, impl, review            |
| sequence-verifiable-units    | plan, impl                    |
| boundary-discipline          | plan, impl, review            |
| test-behavior                | plan, impl, verify            |
| prove-it-works               | impl, verify                  |
| attack-the-premise           | impl (round 2+ of the loop)   |
| escalate-only-decisions      | task (orchestrator), all steps|

## 2. Flow

```
triage ⇄ you ─⛩─▶ plan ⇄ you ─⛩─▶ impl ─▶ verify ─▶ learn ─▶ ship ─⛩ you merge
                                     ▲         │
                                     └─────────┘  max 3 rounds
```

`⛩` = waits for you. `⇄ you` = iterative: the agent writes questions as plain text, you
answer in the pane or in the Slack thread.

| Step   | Runs as                      | Model  | Reads                         | Writes                    |
|--------|------------------------------|--------|-------------------------------|---------------------------|
| triage | task session (interactive)   | Opus   | request, code, ADRs, glossary | `RESEARCH.md`, `BRIEF.md` |
| plan   | task session (interactive)   | Opus   | `BRIEF.md`, code, ADRs        | `SPEC.md`                 |
| impl   | subagent per task, in waves  | Sonnet | `SPEC.md`, code               | code + UT/IT/contract tests |
| verify | 2–3 subagents in parallel    | Sonnet + Opus | see §3.4               | `VERIFY.md`               |
| learn  | subagent                     | Opus   | all task files, diff          | `LEARN.md` (proposals)    |
| ship   | task session                 | Sonnet | all task files                | PR                        |

### Transitions (auto-advance)

| Transition         | Default                                   |
|--------------------|-------------------------------------------|
| triage → plan      | wait: you approve `BRIEF.md`              |
| plan → impl        | wait: you approve `SPEC.md` (the gate)    |
| impl → verify      | auto                                      |
| verify → impl      | auto, max 3 rounds, then escalate         |
| verify → learn     | auto                                      |
| learn → ship       | auto                                      |
| ship → merged      | wait: you merge the PR                    |

Automatic merge by risk: not in v1.

## 3. Steps

### 3.1 Triage

1. Turn the request into neutral questions about the current code ("how does X work
   today?"). Do not put the wanted change in the questions.
2. A fresh subagent answers them without seeing the request → `RESEARCH.md`
   (facts, with `file:line`).
3. Combine the facts with the request. Ask you questions until the brief is clear.
   Settled domain terms go to `GLOSSARY.md`.
4. Write `BRIEF.md`:

```
Category: bug | feature | chore
Summary: one line
Current behavior:
Desired behavior:
Key interfaces: names of types, functions, endpoints (no file paths)
Acceptance criteria: each one checkable on its own
Out of scope:
```

### 3.2 Plan

`SPEC.md` contains:

- **Acceptance criteria**, numbered `AC1…`.
- **Seams**: the public interfaces where tests go.
- **Implementation plan**: tasks, grouped in waves. Tasks in one wave run in parallel.
- **Verification plan**: one row per check. The checks depend on the scenario.

  | Check | Claim | Kind | How | Evidence |
  |-------|-------|------|-----|----------|

  Kinds: e2e journey (browser / CLI / API), visual comparison, security scan,
  contract, performance, manual (you).
- **Risk**: low / medium / high, blast radius, priority. High risk turns on the
  adversarial review.

### 3.3 Impl

- One subagent per task, wave by wave, in the task's worktree.
- TDD for unit, integration and contract tests: one test → its code → next.
  Red before green. Tests only at the seams from `SPEC.md`.
- A test must fail when the behavior breaks, and keep passing when only the internals
  change.

### 3.4 Verify

One step, subagents in parallel, one `VERIFY.md`:

- **Verifier** (Sonnet). Does not read the source code (prompt rule). Runs the
  verification plan against the running app, through the project's `verify-<app>` skill
  (§5). Verdict per check: `VERIFIED` / `NOT VERIFIED` / `INCONCLUSIVE`, with evidence.
  Also runs Semgrep, ast-grep and gitleaks.
- **Reviewer** (Opus). Reads the diff and `SPEC.md`, not the builder's summary.
  - Writes 2–4 own hypotheses before it reads anything else.
  - Two axes, reported apart: **Standards** (repo rules + code smells) and **Spec**.
  - Reports only findings with confidence ≥ 75, at most 5.
  - Drops issues that already exist on the base branch.
  - In round 2+, first checks each prior finding: fixed / not fixed / no longer applies.
- **Adversary** (only when risk is high). Tries to break the change. A finding counts
  only when a run proves it (failing test, repro, command output).

Loop: a `NOT VERIFIED` check or a blocking finding goes back to impl. Max 3 rounds.
A `root-cause-hash` (step + error class + first frames) stops the loop early when the
same failure repeats. Non-critical findings go into the PR body, with no notification.

### 3.5 Learn

Writes proposals to `LEARN.md`:

- ADRs → `docs/adr/`.
- Glossary changes → `GLOSSARY.md`.
- Feature-map updates for `verify-<app>`.
- Lines for `CLAUDE.md` / `AGENTS.md`.

You accept them by merging the PR (they are part of the diff).

### 3.6 Ship

Commit and PR messages follow the writing skill (ASD-STE100). The PR body contains the
summary, the `VERIFY.md` verdicts, the open non-critical findings and the learn proposals.

## 4. Remote, state, interfaces

### Topology

- One **zellij tab per task**, on the VPS (or locally — same core). In it: an
  interactive `claude` or `pi` running `/orq <task>`. That session orchestrates its own
  task. No fleet-level agent in v1.
- Each task has its own **git worktree**, created before any step.

### Scripts

| Script                     | Does                                                        |
|----------------------------|-------------------------------------------------------------|
| `orq new "<request>"`      | task id, SQLite row, worktree, branch, zellij tab           |
| `orq state <id> <status>`  | updates the SQLite row, adds an event                       |
| `orq ask <id> "<text>"`    | status → WAITING FOR ME, posts to the task's Slack thread   |
| `orq send <id> "<text>"`   | types text into the task's zellij pane                      |
| `orq ls`                   | lists tasks and status                                      |

### Slack bridge

A small bot on the VPS (Socket Mode, no open port, no LLM):

- message "new: …" → `orq new`, reply with the task thread;
- `orq ask` → post in the thread;
- your reply in the thread → `orq send`.

### Files in a project

Everything orqestrai keeps in a project is in one folder, committed with the project:

```
.orqestrai/
  config.toml            base branch, test/lint commands, models per step
  tasks/<id>/
    RESEARCH.md
    BRIEF.md
    SPEC.md
    VERIFY.md
    LEARN.md
```

Project-wide knowledge stays where tools expect it: `docs/adr/`, `GLOSSARY.md`,
`CLAUDE.md` / `AGENTS.md`, `.claude/skills/verify-<app>/`.

### Harnesses

The core works on Claude Code and pi. v1 builds and tests on **Claude Code** first;
pi follows.

### State

- Content: Markdown files + git.
- Index: one SQLite file. `tasks(id, repo, title, step, status, needs_me, pr_url,
  slack_thread, updated_at)` and `events(task_id, at, kind, detail)`.
- Statuses: `TODO`, `IN PROGRESS`, `WAITING FOR ME`, `BLOCKED`, `MERGED`.
- Dashboard: a small web app that reads the SQLite file, served over Tailscale only.

## 5. Verification environment

### The `verify-<app>` skill (one per project)

Generated once with the approach of pstack `create-verification-skill`, maintained by
learn. One skill combines:

- **Launch / Doctor / Cleanup**: start the app from empty data, check it is usable,
  tear down what the run started.
- **Drive**: Playwright for web (later: TesterArmy `e2e` for plain-language steps with
  cached replay), a PTY for CLI, HTTP for APIs.
- **Evidence**: screenshots, transcripts, responses. **Visual comparison**: Playwright
  `toHaveScreenshot()`, baseline from `main`, treatment from the branch.
- **Feature map**: one file per user-facing feature — how to reach it, how to drive it,
  which end state proves it works.

### Running the app on one 16 GB VPS

- **Verify slots.** Only verify needs a running app. A slot is a lock (in SQLite).
  v1: 1 slot. Impl and the other steps do not take a slot, so they still run in parallel.
- **Per slot:** `docker compose -p orq-<id> up` with `mem_limit` on each service.
  Torn down when verify ends.
- **Manual checks:** the slot stays up while the task is WAITING FOR ME, with a TTL
  (e.g. 2 h). The URL is served only on Tailscale (`tailscale serve`).
- **Later: a second VPS with Argo CD** for preview environments per task (ApplicationSet,
  pull-request generator). Until then, the same compose files can also run there with
  `DOCKER_HOST=ssh://verify-box`. No change to the skills.

The `verify-<app>` skill is generated when a project is onboarded into orqestrai, not
before.

## 6. Security (no sandbox in v1)

- Dedicated non-root user, no sudo.
- SSH only over Tailscale. Inbound traffic denied by default.
- GitHub: fine-grained token per repo. Branch protection on `main`; the token cannot
  bypass it.
- Guard hooks (`hooks/guard.sh`, PreToolUse). Active only when `ORQ_TASK` is set, which
  `orq new` / `orq open` do for task sessions; other sessions are not affected.
  - G1 protect base: no push, merge or commit on the base branch; no force push; no
    `gh pr merge`.
  - G2 secrets: no reading or writing `.env*`, keys, credential files.
  - G3 stay inside: file writes and git writes only inside the task worktree; no
    `git worktree add/remove`.
  - G4 destructive: `rm -r`, `find -delete`, `git clean`, `git reset --hard` only inside
    the worktree.
  - They stop mistakes; they are not a security boundary. Tests: `hooks/test-guard.sh`.
- Second lock on the VPS: deny rules for secret files in the user settings
  (`~/.claude/settings.json`). Claude Code enforces them itself, in every session, even
  when the plugin is off.
- Later: a check for API keys written into files (gitleaks covers it in verify).

## 7. Evals (after the first manual run)

`claude plugin eval` with cases in `evals/`, each against a small fixture repo, with a
no-plugin baseline. Priority 1: **principle skills load** when a step names them.
Then: neutral research, question format, no self-approval, approval moves on, git rules.
Later, promptfoo or similar tools for prompt-level comparisons.

## 8. Not in v1

Fleet-level orchestrator, automatic merge, `.out-of-scope/` knowledge base, formal
verification, metrics/tracing, playbooks per work type, self-improvement,
Kubernetes preview environments, TesterArmy `e2e` (experiment after Playwright works).

## 9. Open questions

Settled 2026-11-01:

- Task files live in `.orqestrai/` in the project (§4).
- Claude Code first, pi after (§4).
- No external project yet: orqestrai itself is built first. `verify-<app>` comes at
  onboarding (§5).

Open:

1. **Build order.** What is the smallest first slice of orqestrai itself? Proposal:
   `orq new` + one task session that runs triage → plan locally, with no Slack and no
   dashboard. Then impl + verify, then ship, then Slack, then the dashboard.

## 10. Where the ideas come from

| Idea                                              | From             |
|---------------------------------------------------|------------------|
| Agent sessions in visible zellij tabs; send to pane | firstmate      |
| Scripts own mechanics, agents own judgment; word budget | firstmate  |
| Brief format, glossary, TDD at seams, two-axis review | mattpocock   |
| Neutral research questions; auto-advance per transition | humanlayer |
| Hypotheses first, prior findings, root-cause-hash, guard hooks | super-board |
| Confidence ≥ 75 / max 5, pre-existing filter       | shipwright      |
| interrogate, verify-this, create-verification-skill | pstack         |
| Plain-language e2e with cached replay              | TesterArmy e2e  |
