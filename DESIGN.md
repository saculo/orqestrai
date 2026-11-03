# orqestrai — design v1

Status: draft for review, 2026-11-01, updated 2026-11-02. Mark it up: cross out, add, ask.
Source of the ideas: `orqestrai.md`, the comparison of super-board, humanlayer, pstack,
firstmate, shipwright and mattpocock/skills, and later pilloPl's skills and the asdlc
compendium (see §10). Ideas are taken in our own words, never copied 1:1.

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
| plan   | task session (interactive)   | Opus   | `BRIEF.md`, `RESEARCH.md`, code, ADRs | `SPEC.md`         |
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

### 3.0 Grilling (triage and plan)

Both interactive steps ask questions the same way (`skills/grill`):

- **Design tree.** Decisions depend on each other. A round asks the whole **frontier**:
  every open decision whose prerequisites are settled. An answer opens or removes
  branches; then the next frontier is asked. A question that depends on another open
  question waits for a later round.
- Each question is numbered and has a recommended answer, worded so that "yes" accepts it.
- **Facts are the agent's job.** A fact (what the code does, what exists) goes to a
  researcher subagent, never to you. Decisions are yours.
- Each answer is written into the step's file at once, so a restart loses nothing.
- Done when the frontier is empty: no branch left silently assumed.
- **Domain modeling while grilling**: check your terms against `GLOSSARY.md`, sharpen
  vague words, invent edge-case scenarios, and check claims against the code. Extra
  modeling questions come only on signals (§3.7). Keep it calm: one signal, a few
  questions, no workshop.

### 3.1 Triage

Goal: a brief so clear that no new information is needed later.

1. **Read and check what exists.** Request, `CLAUDE.md`, `GLOSSARY.md`, ADR titles.
   Look for an existing implementation **by domain concept**, not by the request's words.
   Read `.orqestrai/out-of-scope/` for a prior rejection of the same concept.
2. **Neutral research.** Turn the request into neutral questions about the current code
   ("how does X work today?"). Do not put the wanted change in the questions. A fresh
   subagent answers them without seeing the request → `RESEARCH.md` (facts, with
   `file:line`).
3. **Check the claim.** Bug: reproduce it if cheap. Feature: does it already exist?
4. **Recommend.** Q1 of the first round: the agent's reading (category, confirmed or not,
   do it / drop it, rough scope). Stops early before deep grilling on something you would
   drop.
5. **Grill** (§3.0) until the problem and its scope are clear.
6. Write `BRIEF.md`. It describes the problem, not the solution. Acceptance criteria go
   to the plan.

```
Category: bug | feature | chore
Summary: one line
Current behavior:
Desired behavior:
Scope:
Out of scope:
```

A rejected feature goes to `.orqestrai/out-of-scope/<concept>.md`: the decision, the reason, the
requests that asked for it. One file per concept. An already-built feature is not
rejected and does not go there.

### 3.2 Plan

1. Read the brief, the research, the code.
2. **Grill** (§3.0) the design decisions: behaviors, seams, data structure, scope edges,
   risk. Answers go into the **Decisions** section of `SPEC.md` as they come.
3. **Confirm the seams** with you: the highest seam possible, as few as possible (one is
   ideal), existing seams before new ones.
4. **Write the rest of `SPEC.md` as a synthesis** of the decisions. No new decisions here;
   anything not decided is marked as an assumption.
5. Gate: you approve `SPEC.md`.

`SPEC.md` contains:

- **Decisions**: the grilling log, question → answer.
- **Acceptance criteria**, numbered `AC1…`.
- **Problem class** per operation (CRUD / transformation & presentation / integration /
  resource contention). It picks the building blocks and the test strategy (§3.7).
- **Seams**: the public interfaces where tests go.
- **Behaviors**: per AC, the behavior in glossary language (given / when / then), what
  is observed, and its hard-to-test pattern, if any (§3.3).
- **Implementation plan**: tasks, grouped in waves. Tasks in one wave run in parallel.
- **Verification plan**: how each AC is proven — a test written in impl, a check run in
  verify, or both. One row per check:

  | Check | Claim | Kind | How | Committed? | Evidence |
  |-------|-------|------|-----|------------|----------|

  Kinds: e2e journey (browser / CLI / API), visual comparison, security scan,
  contract, performance, manual (you). **Committed?** is set for e2e checks: yes = a
  test in the project's e2e module, kept as a regression test; no = the verifier only
  drives the app ("clicking") and keeps the evidence.
- **Risk**: low / medium / high, blast radius, priority. High risk turns on the
  adversarial review.

### 3.3 Impl

- One subagent per task, wave by wave, in the task's worktree.
- TDD for unit, integration and contract tests: one test → its code → next.
  Red before green. Tests only at the seams from `SPEC.md`.
- A test must fail when the behavior breaks, and keep passing when only the internals
  change.
- Impl does not write e2e tests; the e2e writer in verify does (§3.4).

Test guidelines, two layers:

- **General** (`skills/principle-test-behavior/GUIDELINES.md`): what and why;
  independent of language and framework.
- **Per project** (`.orqestrai/testing.md`): with what — tools, commands, existing
  doubles and containers, examples of good tests in the repo. Created at onboarding,
  adjusted by learn during the project's life.

Read by plan (behaviors, levels, verification plan), impl (writes the tests) and the
reviewer in verify (each assertion: OK or SMELL with the reason; a SMELL is a Standards
finding).

| Level       | What "one behavior" is                                          |
|-------------|-----------------------------------------------------------------|
| unit        | a business rule, through the module's public API, in memory; pure logic, no storage |
| integration | the same behavior with real infrastructure                      |
| contract    | the shape and meaning of what crosses a service boundary        |
| e2e         | a user journey through the running app                          |

- Contracts get contract tests. Behaviors get integration and e2e tests.
- Assert on what a user or another system can observe, never on internal state.
  Exception: CRUD, where saving and reading back is the behavior.
- **Given state:** the data under test and the data it needs come through the app's
  public API, built with small helpers named in glossary words (`aCustomer().vip()`)
  that set only what the test cares about. Base setup (schema, reference data) may use
  scripts or migrations. Each test creates its own data; e2e never seeds by SQL.
- **Level per behavior:** the highest seam where the test is still fast and
  deterministic. Push down to unit for many input variants that change the business
  meaning; push up when the risk is in the wiring (queries, serialization, config).
  An interface layer that only delegates is tested through the layer below it; one with
  logic is tested itself.
- **Real vs double:** a behavior that needs storage is an integration test with the real
  store (testcontainers, localstack), not a unit test with a fake repository. Third-party
  services: network-level doubles (WireMock-style) plus contract tests. Costly calls
  (payment, email, rate limits): a recording double, not a mock; mocks only where no
  double fits.
- Names in glossary language: one sentence about the behavior. E2E tests also carry the
  AC id (`AC3: a VIP customer gets the weekend discount`).
- A flaky test is a failing test, never retried to green: it points to a real problem in
  the code or the test (time, ordering, shared data, async waits). A flaky test already
  on the base branch is reported as pre-existing; learn proposes a task for it.
- No % coverage gate. Every AC is covered by a test or a check (plan), and the reviewer
  flags changed behavior that no test covers.
- Time and concurrency are explicit: an injected clock, race tests for contended data.
- Hard-to-test patterns, each with its way to assert: invisible side effect, expected
  no-op, time-dependent, multi-step process, history-dependent, race, multi-factor
  calculation, permission gate, eventual effect, costly call.

### 3.4 Verify

Three gate tiers: **quality** (deterministic: build, types, lint, tests, scanners),
**review** (reviewer and adversary, fresh contexts, against `SPEC.md`), **acceptance**
(you, at the PR). A gate is added only for a named risk.

One step, subagents in parallel, one `VERIFY.md`:

- **Verifier** (Sonnet). Does not read the source code (prompt rule). Runs the
  verification plan against the running app, through the project's `verify-<app>` skill
  (§5): every check, driven against the app. Writes nothing.
- **E2E writer** (Sonnet), after the verifier, in the same slot. Turns each `VERIFIED`
  check marked "Committed? = yes" into a test in the project's e2e module, from the AC
  text, the verifier's evidence and the running app. Does not read the app's source;
  reads only the e2e module and `.orqestrai/testing.md`. Runs each new test once: if it
  fails while the check passed, it fixes the test, never the app. A `NOT VERIFIED`
  check gets no test. Verdict per check: `VERIFIED` / `NOT VERIFIED` / `INCONCLUSIVE`, with evidence.
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

Writes proposals to `LEARN.md` (the candidate learnings of the run; you pick which
ones stay):

- ADRs → `docs/adr/`.
- Rejected concepts → `.orqestrai/out-of-scope/`.
- Glossary changes → `GLOSSARY.md`.
- Feature-map updates for `verify-<app>`.
- Lines for `CLAUDE.md` / `AGENTS.md`.

You accept them by merging the PR (they are part of the diff).

### 3.6 Ship

Commit and PR messages follow the writing skill (ASD-STE100). The PR body contains the
summary, the `VERIFY.md` verdicts, the open non-critical findings and the learn proposals.

### 3.7 Modeling toolbox (on signals)

Not a step. One small skill per tool; a step loads it only when its signal shows up.
Results go to the **Decisions** section of `SPEC.md`, terms to `GLOSSARY.md`, and an ADR
only when the decision is hard to reverse, surprising without context and a real
trade-off.

In the flow now:

| Skill             | Signal                                   | Does                                   |
|-------------------|------------------------------------------|----------------------------------------|
| problem class     | plan, once per operation                 | CRUD / transformation & presentation / integration / resource contention → building blocks and test strategy |
| consistency unit  | problem class = resource contention      | 5 questions: which commands change the data, which pairs conflict, which invariant breaks, the smallest data the check needs, optimistic or pessimistic lock |
| context distilling| only when needed: a term clashes with `GLOSSARY.md`, or "where does this go?" (triage, plan) | which processes use the term; do their rules differ; different names, same behavior → split into two terms or merge into one; writes the glossary only |

Drafts, outside the flow for now:

| Skill               | Possible signal                          | Idea                                    |
|---------------------|------------------------------------------|-----------------------------------------|
| representation lens | the domain answers a question badly      | the question's operation → the model that makes it native |
| archetypes          | "have we seen this problem shape before?"| short cards (signals, anti-signals, one deciding question), checked one by one, default "doesn't fit" |

Drafts live in `drafts/` in the orqestrai repo; `orq init` does not install them. A draft
moves to `skills/` when a step names it. The in-flow skills are written with the next
plan-skill rewrite; the drafts after the test guidelines. Size: the normal skill budget
(~150 lines), not smaller — they need their examples.

Code is DDD-ish where it pays: one bounded context = its own files and glossary.

## 4. Remote, state, interfaces

### Topology

- One **zellij tab per task**, on the VPS (or locally — same core). In it: an
  interactive `claude` or `pi` running `/orq <task>`. That session orchestrates its own
  task. No fleet-level agent in v1.
- Each task has its own **git worktree**, created before any step.

### The `orq` CLI

TypeScript on Bun, with Effect 4 (`src/`). Rule: **the code does mechanics only** —
ids, state, worktrees, tabs, Slack, slots. Routing, gates and step order stay in the
skills. Size budget: about 150 lines per module. `src/domain.ts` is the one definition of
steps, statuses and task fields. Tests drive the CLI (`test/`).

Install: an npm package run with Bun (`bunx orqestrai init`), not a Claude Code plugin.
Bun is needed at runtime (`bun:sqlite`).

| Command                    | Does                                                        |
|----------------------------|-------------------------------------------------------------|
| `orq init`                 | creates `.orqestrai/`, writes skills, agents and the guard hook into `.claude/` |
| `orq guard`                | the PreToolUse guard hook (§6)                              |
| `orq new "<request>"`      | task id, SQLite row, worktree, branch, zellij tab           |
| `orq open <id>`            | opens the task's tab again (after a restart)                |
| `orq state <id> <step> <status> [note]` | updates the SQLite row, adds an event          |
| `orq show <id>`            | one task and its last events                                |
| `orq file <id> <NAME>`     | new task file from `templates/`                             |
| `orq ask <id> "<text>"`    | status → WAITING FOR ME, posts to the task's Slack thread   |
| `orq send <id> "<text>"`   | types text into the task's zellij pane                      |
| `orq ls`                   | lists tasks and status                                      |

`orq ask` and `orq send` come with the Slack bridge (slice 4).

### Slack bridge

A small bot on the VPS (Socket Mode, no open port, no LLM):

- message "new: …" → `orq new`, reply with the task thread;
- `orq ask` → post in the thread;
- your reply in the thread → `orq send`.

### Files in a project

Everything orqestrai keeps in a project is in one folder, committed with the project.
`orq init` writes the generated skills, agents and hook settings into `.claude/`; each
generated file says it is generated (edit it in orqestrai).

```
.orqestrai/
  config.toml            base branch, test/lint commands, models per step
  out-of-scope/<concept>.md
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

**Claude Code only** for now. pi may come later; then the guard's decision logic stays
plain TS (no `bun:*` imports), because pi loads extensions under Node.

### State

- Content: Markdown files + git.
- Index: one SQLite file. `tasks(id, repo, title, step, status, needs_me, pr_url,
  slack_thread, updated_at)` and `events(task_id, at, kind, detail)`.
- Statuses: `TODO`, `IN PROGRESS`, `WAITING FOR ME`, `BLOCKED`, `DROPPED` (triage decided not to do it), `MERGED`.
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
- Guard hook (`orq guard`, PreToolUse, in TS; replaces `hooks/guard.sh`). One pure
  function decides allow / block; a shell parser replaces the text checks; tests are bun
  tests. Active only when `ORQ_TASK` is set, which
  `orq new` / `orq open` do for task sessions; other sessions are not affected.
  - G1 protect base: no push, merge or commit on the base branch; no force push; no
    `gh pr merge`.
  - G2 secrets: no reading or writing `.env*`, keys, credential files.
  - G3 stay inside: file writes and git writes only inside the task worktree; no
    `git worktree add/remove`.
  - G4 destructive: `rm -r`, `find -delete`, `git clean`, `git reset --hard` only inside
    the worktree.
  - They stop mistakes; they are not a security boundary.
- Second lock on the VPS: deny rules for secret files in the user settings
  (`~/.claude/settings.json`). Claude Code enforces them itself, in every session, also
  outside task sessions.
- Later: a check for API keys written into files (gitleaks covers it in verify).

## 7. Evals (after the first manual run)

Cases in `evals/`, each against a small fixture repo after `orq init`, with a baseline
without orqestrai. The harness is open: `claude plugin eval` expects a plugin. Priority 1: **principle skills load** when a step names them.
Then: neutral research, question format, no self-approval, approval moves on, git rules.
Later, promptfoo or similar tools for prompt-level comparisons.

## 8. Not in v1

Fleet-level orchestrator, automatic merge, formal verification, metrics/tracing,
playbooks per work type, self-improvement, Kubernetes preview environments, TesterArmy
`e2e` (experiment after Playwright works), pi support.

Not now, maybe later:

- **Workflow as code**: `orq` enforcing step order and gate preconditions. Step order
  stays in the skills (principle 2).
- **Living specs**: one spec per bounded context, describing current behavior, updated in
  the same commit as the code; task `SPEC.md` stays the delta. After the per-task flow is
  solid.
- Spec reversing and characterization tests: for legacy code, which is not in scope yet.

## 9. Open questions

Settled 2026-11-01:

- Task files live in `.orqestrai/` in the project (§4).
- Claude Code first, pi after (§4).
- No external project yet: orqestrai itself is built first. `verify-<app>` comes at
  onboarding (§5).

Settled 2026-11-02:

- Install with Bun + `orq init`, not a plugin; Claude Code only (§4).
- Guard hook in TS (§6).
- Triage: checks for existing work and the out-of-scope notes, a recommendation first, grilling
  as a design tree; no acceptance criteria in the brief (§3.0, §3.1).
- Plan: grill first, confirm seams, then write `SPEC.md` as a synthesis (§3.2).
- Test levels and rules (§3.3); gate tiers (§3.4).
- No needs-info / ready-for-human outcomes: triage goes deep enough instead.

Open:

1. **Build order.** Slice 1 (`orq new`, triage → plan) is done. Proposal: then impl +
   verify, then ship, then Slack, then the dashboard.
2. ~~Modeling toolbox~~: settled 2026-11-02 (§3.7).
3. **Test guidelines** (§3.3): the full document and the principle skill that points to it.

## 10. Where the ideas come from

| Idea                                              | From             |
|---------------------------------------------------|------------------|
| Agent sessions in visible zellij tabs; send to pane | firstmate      |
| Scripts own mechanics, agents own judgment; word budget | firstmate  |
| Brief format, glossary, TDD at seams, two-axis review | mattpocock   |
| Design-tree grilling, out-of-scope, recommend first, seams first | mattpocock |
| Observable behaviors, hard-to-test patterns        | pilloPl          |
| Problem classes, consistency units, context distilling, archetypes, representation lens | pilloPl |
| Gate tiers, compound learn loop, model routing     | asdlc            |
| Neutral research questions; auto-advance per transition | humanlayer |
| Hypotheses first, prior findings, root-cause-hash, guard hooks | super-board |
| Confidence ≥ 75 / max 5, pre-existing filter       | shipwright      |
| interrogate, verify-this, create-verification-skill | pstack         |
| Plain-language e2e with cached replay              | TesterArmy e2e  |
