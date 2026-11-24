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

Short skills (`plugin/skills/principles/`, adapted from pstack, MIT). Each step skill names the
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

A **playbook** is the order of steps a task runs. The playbooks are skills,
`plugin/skills/workflow/playbook-<name>/`: the description says when one fits, the body
lists the steps, the gates and what the task ends with. `orq:task` is the base every
playbook shares (where the task is, the records, the gates, talking to you). At its start
it reads the task's playbook from `orq show`; when none is set, it compares `REQUEST.md`
with the playbook descriptions, picks one and records it (`orq set-state <id> triage
"IN PROGRESS" --playbook <name>`), or asks you when none fits clearly or two do. You can set
it yourself: `orq new --playbook <name>`. A task that turns out to be of another kind
stops and asks before it switches. A new playbook is one new skill; it reuses the step
skills, and steps are the ones in `packages/core/src/domain.ts`.

There is one playbook now, **feature**, the flow below.

```
triage ⇄ you ─⛩─▶ plan ⇄ you ─⛩─▶ impl ─▶ verify ─▶ learn ─▶ ship ─⛩ you merge
                                     ▲         │
                                     └─────────┘  max 3 rounds
```

`⛩` = waits for you. `⇄ you` = iterative: the agent writes questions as plain text, you
answer in the session (the Herdr app or `hc attach`).

| Step   | Runs as                      | Model  | Reads                         | Writes                    |
|--------|------------------------------|--------|-------------------------------|---------------------------|
| triage | task session (interactive)   | Opus   | request, code, ADRs, glossary | `RESEARCH.md`, `BRIEF.md` |
| plan   | task session (interactive)   | Opus   | `BRIEF.md`, `RESEARCH.md`, code, ADRs | `SPEC.md`         |
| impl   | subagent per task, in waves  | Sonnet | `SPEC.md`, code               | code + UT/IT/contract tests |
| verify | 2 subagents in parallel      | Sonnet + Opus | see §3.4               | `VERIFY.md`, e2e tests    |
| learn  | subagent                     | Opus   | all task files, diff          | `LEARN.md` + the applied proposals |
| ship   | task session                 | Sonnet | all task files                | `PR.md`, the PR           |

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

Both interactive steps ask questions the same way (`plugin/skills/workflow/grill`):

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

  | Check | Claim | Surface | Kind | How | Evidence |
  |-------|-------|---------|------|-----|----------|

  Kinds: `e2e` (a committed test in the project's e2e suite; the default), `driven`
  (the verifier drives the app by hand: how a screen looks, or a test that costs far
  more than it protects), `manual` (you, at the PR). `driven` and `manual` need a
  reason. Each behavior has one level, so an e2e behavior is not tested again lower.
- **Risk**: low / medium / high, blast radius, priority. High risk will turn on the
  adversary (§3.4, later).

### 3.3 Impl

- One subagent per task, wave by wave, in the task's worktree.
- **A subagent gets only its task:** the task block from `SPEC.md`, the ACs and behaviors
  it serves, the seams, the Design decisions that apply, `GLOSSARY.md`, the test
  guidelines and `.orqestrai/testing.md`. Not the brief, the research or the chat. When it
  needs something the spec does not say, it reports the gap and stops; it does not guess.
- **Subagents edit and test; they do not commit.** Tasks of one wave share the worktree's
  git index. After the wave, the task session commits each task separately (`orq:git`).
- TDD for unit, integration and contract tests: one test → its code → next.
  Red before green. Tests only at the seams from `SPEC.md`.
- A test must fail when the behavior breaks, and keep passing when only the internals
  change.
- Impl does not write or change e2e tests; the verifier in verify does (§3.4).

Test guidelines, two layers:

- **General** (`plugin/skills/principles/principle-test-behavior/GUIDELINES.md`): what and why;
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
**review** (verifier and reviewer, fresh contexts, against `SPEC.md`), **acceptance**
(you, at the PR). A gate is added only for a named risk.

**E2E first.** A check that can be an e2e test *is* an e2e test: the test is the proof,
and it stays in the project's e2e suite as a regression test. A check that cannot be a
test is driven by hand. Only what no agent can judge goes to you. Nothing is proven twice.

One round:

```
1. Quality gate     ## Checks of the AGENTS.md of each changed component; no app
2. In parallel:
   Verifier (never reads source)            Reviewer (never runs the app)
     starts the app once, free ports          reads diff + SPEC
     e2e:    writes the test (round 1) or     hypotheses first, Spec + Standards
             reruns it (round 2+), runs it    ≥75 confidence, max 5
     driven: drives the app, keeps evidence   round 2+: prior findings
     manual: not run; goes to you at the PR
3. Commit the e2e tests (failing ones too); the verifier stops the app
4. VERIFY.md: failing items → impl (max 3 rounds), else passed → learn
```

- **Verifier** (Sonnet). Does not read the app's source, its other tests or the diff
  (prompt rule). Reads the `verify-<surface>` skills (§5), the e2e suite they name and
  `.orqestrai/testing.md`. With e2e-inc/e2e it writes a test while it walks the flow over
  `e2e mcp`, and each run's evidence (screenshots, trace page, `report.json`) goes to the
  task's `evidence/`. When a new e2e test fails, it drives that step by hand once:
  the app is wrong → `NOT VERIFIED`; the test is wrong → it fixes the test (at most 2
  times); unclear → `INCONCLUSIVE`. Verdict per check: `VERIFIED` / `NOT VERIFIED` /
  `INCONCLUSIVE`, with evidence. One app instance serves the e2e and the driven checks.
- **E2E tests are the spec of the check.** Impl never changes them. When impl thinks one
  is wrong, it reports a gap; the verifier decides in the next round, by driving the app.
- **Reviewer** (Opus). Reads the diff and `SPEC.md`, not the builder's summary.
  - Writes 2–4 own hypotheses before it reads anything else.
  - Two axes, reported apart: **Standards** (repo rules + code smells) and **Spec**.
  - Reports only findings with confidence ≥ 75, at most 5.
  - Drops issues that already exist on the base branch.
  - In round 2+, first checks each prior finding: fixed / not fixed / no longer applies.
- **Adversary**: later, optional, only for risk `high`. It reads the diff, guesses where
  the change breaks (empty input, two calls at once, a missing permission, a retry after
  a timeout) and proves it with a run; its repros go to `evidence/adversary/`, never into
  the test suite; a proven finding goes back to impl, which writes the regression test.
  In round 2+ it reruns its repros only.

Loop: a `NOT VERIFIED` check or a blocking finding goes back to impl. Max 3 rounds.
A `root-cause-hash` (step + error class + first frames) stops the loop early when the
same failure repeats. After the third failed round, or a repeated root cause, the task
goes to `WAITING FOR ME` with a short summary from `VERIFY.md`. Non-critical findings go
into the PR body, with no notification.

The quality gate runs with no app. Its checks are written in Markdown, in `AGENTS.md`,
under `## Checks`: the repository's, and one per service or app that has its own. A
changed file belongs to the nearest folder above it whose `AGENTS.md` has that section;
verify runs each such folder's checks there, as written. orq keeps no commands, and CI is
the project's own.

```markdown
## Checks

    go vet ./...
    go test ./...
```

A changed file with no `## Checks` above it is reported as "not configured": checks are
never guessed, and it never fails the gate. orq knows nothing about the e2e suite: the
surface's verify skill names it and how to run it (§5). A surface whose skill names no
suite has its e2e checks driven by hand, and the round says so.

**Models:** fixed in the agent files (`model:` in the frontmatter): implementer and
verifier Sonnet, reviewer Opus. Per-project models in `config.toml` come when a project
needs them.

### 3.5 Learn

One `orq:learner` subagent (Opus) reads all task files and the diff, and keeps what the
next task needs to know. **At most 5 proposals, each with its evidence in this task** (a
verify round, a finding, a decision). "No proposals" is a good result.

| Signal in the task | Goes to |
|--------------------|---------|
| a decision hard to reverse, surprising, a real trade-off | ADR in `docs/adr/` |
| a new term, or one term in two meanings | `GLOSSARY.md` |
| the user rejected a concept | `.orqestrai/out-of-scope/<concept>.md` |
| a root cause that came back, a rule the reviewer repeated | `CLAUDE.md` / `AGENTS.md` |
| a flaky test, a hard-to-test pattern, a missing helper | `.orqestrai/testing.md` |
| the verifier could not start, seed or drive the app as the skill says | `verify-<surface>` |

Each proposal is **applied in the task branch** and listed in `LEARN.md`. You accept it by
merging the PR, or ask at the PR to drop it. No gate. The task session checks the
learner's work: no evidence, generic, or already known → reverted.

### 3.6 Ship

1. Rebase onto the base branch (`git fetch`, `git rebase origin/<base>`). A conflict that
   changes behavior → `WAITING FOR ME`.
2. The quality gate again. A failure → `WAITING FOR ME`, no PR.
3. `PR.md` from the task files: what and why (brief), each AC with its verdict and
   evidence, the manual checks for you, verify rounds, open findings, learn proposals,
   decisions, risk. Copied, not invented.
4. Push the task branch, `gh pr create --body-file PR.md`, `WAITING FOR ME`. orq finds the
   PR by the task's branch and records it as the task's `gh-pr` link.

After that: **merge is yours.** `orq ls` / `orq show` ask `gh` for the state of each open
task's PR and set `MERGED` when it is merged (no webhook, no daemon; when `gh` fails, the
task stays as it is). Changes you ask for at the PR go through impl → verify → ship again,
which updates the body with `gh pr edit`.

`orq clean <id>` (you run it; the guard blocks it in a task session) ends the task's
session and removes the worktree and the local branch of a `MERGED` or `DROPPED` task. The task row, its links and
its events stay. It refuses when the worktree has uncommitted changes, or when the branch
has commits the PR does not have. A merged task's files are in the base branch already;
a dropped task is never merged, so its task folder and the out-of-scope notes on its
branch are first copied to `~/.orqestrai/archive/<repo>/<id>/`, where triage looks for
earlier drops. It refuses a dropped branch that changes any other file.

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
| representation lens | the domain answers a question badly      | the question's operation → the model that makes it native; business and technical examples |
| archetypes          | "have we seen this problem shape before?"| one card per archetype with business **and** technical words (availability = resource pool, plan vs actual = reconciliation loop, …) plus a pipeline card; checked one by one, default "doesn't fit" |

Drafts live in `drafts/modeling/` in the orqestrai repo; the plugin does not include them. A draft
moves to `plugin/skills/modeling/` when a step names it. The in-flow skills are written with the next
plan-skill rewrite; the drafts after the test guidelines. Size: the normal skill budget
(~150 lines), not smaller — they need their examples.

Code is DDD-ish where it pays: one bounded context = its own files and glossary.

## 4. Remote, state, interfaces

### Topology

orq knows no machines. One setting decides how the pieces find each other: `server`.

- **No `server`** (one machine: a laptop or one server): orq keeps its state in a local
  SQLite file. There is no server process.
- **`server` set** (several machines): one machine runs `orq-server`, as a process, a
  container or anything else; every other machine points `server` at it.

The pieces:

- **Task sessions**: Claude Code with the orqestrai plugin, one per task, in a
  **herdr-core terminal** (`orq-t-0001`), in the task's own **git worktree**, inside the
  sandbox command you choose (or none). It stays alive with nobody watching; you attach
  with `hc attach` or the Herdr app (desktop or phone, over SSH) at any time. No
  fleet-level agent in v1.
- **orq-server** (optional): the state for every machine, over HTTP, and the dashboard. It
  only touches its database and never runs a command.
- **The app under test**: started by the verifier, or deployed by something else (a
  preview). The project's `verify-<surface>` skill says which (§5).

Required: Claude Code, Bun, git, `gh` (GitHub) and herdr-core (`hc`). A sandbox, a second
machine, containers, Kubernetes and CI are optional; orqestrai does not know about them.
My own setup (servers, k3s, Argo CD, OpenBao, Tailscale, a home repo of shared skills)
is my own repositories' business, not orqestrai's.

### Parts and install

Three parts, installed on their own, one version, from one repository with three
packages (`packages/`): `core` (the state and its API, shared, not published), `cli` and
`server`.

| Part | Install | Run |
|---|---|---|
| The CLI | `bun add -g orqestrai` (npm; one bundled file, core in it) | `orq …` |
| Skills, agents, the guard hook | `claude plugin install orq@orqestrai` (user scope), or the plugin in a project's committed `.claude/settings.json` | Claude Code |
| The server (optional) | the image `ghcr.io/saculo/orqestrai:<version>`, or `orq-server-linux-x64` from the release | `orq-server` |

A tag `v<version>` publishes the CLI to npm, both binaries to the release and the server's
image to GHCR. The CLI and the server share core, so they always agree on the API
(`packages/core/src/api.ts`). The plugin needs `orq` on PATH: its hook and its skills run
it by name. A project can also keep its own
skills, agents and hooks in its `.claude/`; that works with or without anything else.

### Configuration

All of orq's settings are in one file, `~/.config/orqestrai/config.toml` (`ORQ_CONFIG`
names another). You edit it by hand. Every key is optional:

```toml
server   = "http://orq.example:7400"    # unset: local SQLite, no server
sandbox  = "fence --"                   # a command prefix for task sessions; unset: none
add_dirs = ["~/shared-skills"]          # more directories for every task session (--add-dir)
model    = "opus"                       # the task session's model
data     = "~/.orqestrai"               # worktrees, archive, the local SQLite file
hc       = "hc"                         # the herdr-core command, which keeps the task sessions

[github]
user     = "me"                         # orq issues reads issues you opened only
repos    = { "me/my-app" = "~/Projects/my-app" }  # a repo and the checkout where its tasks start
```

orq keeps no list of projects. `orq new` starts the task in the repo it runs in, so it
works the same from inside a project as from anywhere that `cd`s there first (for
example a home directory whose `CLAUDE.md` lists your projects).

- **Secrets are never in this file**, so sessions can read the config.
- An environment variable `ORQ_<KEY>` overrides a key, for tests and containers
  (`ORQ_SERVER`, `ORQ_SANDBOX`, `ORQ_DATA`, …; `[github]` is `ORQ_GITHUB_USER` and
  `ORQ_GITHUB_REPOS=me/app=/path,…`). `packages/core/src/settings.ts` reads the file into these variables at start, and the rest of orq
  reads only variables. A key orq does not know is an error, so a typo is not ignored.
- What belongs to a project is in the project: `.orqestrai/config.toml` (base branch),
  written by `orq init`, and the `## Checks` of its `AGENTS.md` files.

### The `orq` CLI

TypeScript on Bun, with Effect 4 (`packages/cli/src/`, on `packages/core/src/`). Rule:
**the code does mechanics only** — ids, state, worktrees, sessions. Routing, gates, step
order and the choice of playbook stay in the skills. Size budget: about 150 lines per
module. `packages/core/src/domain.ts` is the one definition of
steps, statuses and task fields. Tests drive the CLI (`test/`).

The plugin `orq` (`plugin/`; the repository is its marketplace,
`.claude-plugin/marketplace.json`) holds the skills, the agents and the guard hook.
Skills and agents are named `orq:<name>` (`/orq:task`); the folder name is the name.
`test/plugin.test.ts` checks that every `orq:<name>` mentioned exists.

| Command                    | Does                                                        |
|----------------------------|-------------------------------------------------------------|
| `orq init`                 | creates `.orqestrai/config.toml`                            |
| `orq guard`                | the PreToolUse guard hook (§6)                              |
| `orq new [--playbook <name>] [--origin <kind>:<ref>] "<request>"` | task id, task row, worktree, branch, session; the origin linked |
| `orq resume <id>`          | starts the task's session again if it is not running (after a restart) |
| `orq set-state <id> <step> <status> [--note <text>] [--playbook <name>]` | updates the task row, adds an event; a waiting note is the whole message |
| `orq show <id>`            | one task, its links and its last events                     |
| `orq create-artifact <id> <NAME>` | a task file from `templates/`                        |
| `orq issues`               | a task for each new GitHub issue of yours (below)           |
| `orq ls`                   | lists tasks and status; reads merged PRs from `gh`          |
| `orq clean <id>`           | ends a merged or dropped task's session, removes its worktree and branch |

**Server and clients.** `orq-server` (`packages/server/`) offers the `Db` service as an
HTTP API (`packages/core/src/api.ts`, Effect's `HttpApi`), on a Unix socket, a TCP
address or both, and the dashboard at `/`. With `server` set (a socket path or a URL),
the CLI uses the API's generated client (`packages/core/src/remote.ts`).
Without it, orq opens the local SQLite file itself. Task sessions in a sandbox use a server
even on one machine (a socket, the server outside the sandbox), so the state is never
writable from inside it. Over TCP the server does not
authenticate callers: put it where only your machines reach it.

Skills and agents reach orq only through the CLI, over Bash. There is no MCP server: one way
in keeps the commands, the guard and the tests the same for every caller.

### Sessions

- orq starts sessions with no parent terminal (`--outlive-parent`, no `HC_TERMINAL_ID`), so
  a session started from another one outlives it. You answer a session by typing in it
  (the Herdr app, or `hc attach orq-t-0001`).
- **Git and GitHub:** the session itself pushes its branch and opens the PR with `gh`
  (see Security).
- **Project space:** a task session starts only in the project's Herdr space: `herdr_session`
  in `.orqestrai/config.toml`, else the repository's directory name. The terminal carries the
  label `herdr.space`; `orq resume` adds it to a running task terminal that has none.
- **Space not open:** when no terminal is open in the project's space, `orq new` and
  `orq issues` keep the task and its worktree but start no session. orq names the space and
  says to open it in the Herdr app, then run `orq resume <id>`. `orq new` and `orq resume`
  exit non-zero. An hc failure stops orq with hc's message. Without `hc`, orq prints the
  command to start the session by hand.
- orq inside a task session passes its terminal's socket (`HC_TERMINAL_SOCKET`) to hc as
  `HC_SOCKET`.
- **Pre-trust:** `orq new` and `orq resume` set `hasTrustDialogAccepted` for the worktree in
  `projects[<worktree>]` of Claude's config (`$CLAUDE_CONFIG_DIR/.claude.json`, else
  `~/.claude.json`), so the folder trust dialog never blocks. `orq clean` removes the entry.
  A config file that is not valid JSON is left as it is, with a warning.

### GitHub issues

Optional. One long-running process, `orq issues` (`packages/cli/src/issues.ts`; no open port, no LLM),
on the sessions' machine, outside the sandbox. Every minute it lists, with `gh`, the open
issues `[github] user` opened in each repo of `[github] repos`, and starts a task for each
one that no task is linked to (`gh-issue`, the issue's URL): `orq new` in that repo's
checkout, with the issue's title as the title and its text as the request, source `github`,
the issue linked as its origin before the session starts. Then it comments on the issue
with the task's id, status and branch. A failure is printed and tried again a minute later.
Issues by anyone else are never read. That is all for now: questions, replies and the PR
stay in the session, the dashboard and GitHub as before.

### Files in a project

Everything orqestrai keeps in a project is in one folder, committed with the project.
The skills, agents and hook come from the plugin, not from files in the project.

```
.orqestrai/
  config.toml            base branch
  out-of-scope/<concept>.md
  tasks/<id>/
    RESEARCH.md
    BRIEF.md
    SPEC.md
    VERIFY.md
    evidence/
    LEARN.md
    PR.md
```

Project-wide knowledge stays where tools expect it: `docs/adr/`, `GLOSSARY.md`,
`CLAUDE.md` / `AGENTS.md`, `.claude/skills/verify-<surface>/`.

### Harnesses

**Claude Code only** for now. pi may come later; then the guard's decision logic stays
plain TS (no `bun:*` imports), because pi loads extensions under Node.

### State

- Content: Markdown files + git.
- Index: one **SQLite** file, `<data>/state.db`, opened by `orq-server` or, without a server,
  by the CLI itself (`bun:sqlite`). No database to install. A transaction takes the write
  lock (`BEGIN IMMEDIATE`), so parallel runs wait their turn and never share an id.
  `tasks(id, repo, title, branch, worktree, step, status, type, source, created_at, updated_at)`,
  `events(seq, task_id, at, kind, detail)`, `task_links(seq, task_id, kind, ref, role)` and
  `task_files(task_id, path, sha256, content)`: a copy of each task's files for the dashboard
  (below).
  Step, status, the type (the playbook's name) and the source (where the task was started:
  `cli`, `github`, and `slack` for tasks from the Slack bridge orq once had) are checked by the database too.
  - Several machines share one state through `orq-server`, the only process that opens the
    file.
  - Nothing opens it until a command needs state, so `orq guard` and `orq init` work
    without one.
  - The schema is **migrations**: numbered files in `packages/core/src/migrations/`, run in order and
    recorded. A merged migration is frozen; a change is a new file.
  - Tests use a fresh file per test. No containers.
- The task holds only what is orqestrai's own. Everything outside — the GitHub issue,
  the Linear or Jira ticket, the PR — is a **link**: an open `kind`, a
  `ref` in that system, and a `role` (`origin` = where the request came from, `related`).
  Only the adapter that owns a kind reads its refs, so a new trigger adds no column.
- Statuses: `TODO`, `IN PROGRESS`, `WAITING FOR ME`, `BLOCKED`, `DROPPED` (triage decided not to do it), `MERGED`.
- Archive: `<data>/archive/<repo>/<id>/`, the files of dropped tasks after `orq clean`.
- **Dashboard:** `orq-server` serves it at `/` (`packages/server/src/dashboard.ts`, the page in
  `packages/server/src/dashboard/`: React, bundled by Bun itself, so there is no build step and it is
  inside the compiled binary too). The page keeps its logic in plain, tested modules
  (`serverApi.ts`, `tasks.ts`, `board.ts`, `taskFiles.ts`, `hooks.ts`) and draws with small
  components named for what they show (`components/`: `NeedsYou`, `TaskBoard`, `TaskPanel`,
  `TaskFileViewer`, `Timeline`…). Read-only: a board by step, "needs you" on top with the
  whole message (`orq set-state` keeps a waiting note as a `message` event), and per task its files, the verify
  screenshots and the timeline. The files come from the database: whenever a step reports
  (`orq new`, `orq set-state`) the CLI sends what changed in the task's folder
  (`packages/cli/src/files.ts`; only `<NAME>.md` task files and images under `evidence/`, at most 60
  images of 10 MB), so the page is the same when the worktrees are on another machine. It polls
  `/board` every 5 s. `orq-server` listens on a socket and a TCP port at once, so the
  sessions keep the socket and a browser uses the port, on a private address.

## 5. Verification environment

### The `verify-<surface>` skills (one per surface)

A surface is a part of the app that a check drives: `api`, `web`, `cli`. A project with
one surface has one skill, named after that surface (`verify-api` for an API). Each check in the verification plan names its
surface; the verifier loads only the skills of the surfaces in the task. The skill is a
**driver's manual, not a test list**: what to check is in the task's `SPEC.md`, the
committed e2e tests are in the project's e2e suite. Plan asks you when a surface in the
plan has no skill yet. Learn changes a skill only when the way to drive the app changed.

**e2e-inc/e2e** drives the surfaces it can (web, iOS and Android, APIs): the project runs
`npx e2e init` (e2e is pinned in its `package.json`), and the skill is generated with
e2e's `create-verification-skill`. Its agent steps run on the Claude subscription through
the `claudeCode` executor (`@e2e-dev/acp`); a step that a later check confirmed is
replayed from `.e2e/cache/`, committed with the tests, so a rerun costs no model call
until the app changes. A surface e2e cannot drive (a CLI) gets a skill written by hand.
One skill combines:

- **Launch / Doctor / Cleanup**: how to get a running app for this task, check it is
  usable, and tear down what the run started. The project decides, and orqestrai does
  not: start it locally on free ports, named after the task (`orq-<id>`); or push the
  branch, open a draft PR, and wait until a preview that something else deploys serves
  this commit (e.g. a `/version` endpoint that returns the SHA). Nothing in orq depends
  on which.
- **Drive**: e2e-inc/e2e (a test, or live over `e2e mcp`); a PTY for a CLI.
- **Evidence**: screenshots, trace pages, responses, into
  `.orqestrai/tasks/<id>/evidence/`; the PR description shows each check's screenshot.
  Videos stay out of git.
  **Visual comparison**: Playwright `toHaveScreenshot()`, baseline from `main`, treatment
  from the branch.
- **Feature map**: one file per user-facing feature — how to reach it, how to drive it,
  which end state proves it works.

e2e runs in verify, where the session is; CI does not need to run it. The app's own
secrets stay with whatever runs the app (test or sandbox keys only); sessions never see
them.

The `verify-<surface>` skills are generated when a project is onboarded into orqestrai, not
before.

## 6. Security

The rule: **an agent can use what it needs but cannot read a secret.** A process that uses
a secret holds it in plain text, and anything running as the same user can read it. So
agents get actions (orq's commands), never credentials.

- **Sessions** run inside the sandbox command you configure (`sandbox`), e.g. Fence
  (bubblewrap): its own network allowlist, files and process namespace. orqestrai does not
  depend on which one. A good sandbox for task sessions:
  - hides the secret files (cloud credentials, tokens);
  - allows the network only to GitHub, Anthropic, `orq-server` and what the app under test
    needs;
  - keeps `orq` and the sandbox's own config read-only, so a session cannot change them.
- **`orq-server`** holds the state and runs no command, so a session cannot make it run its
  code.
- GitHub: the one secret a session can read, so it can do little. A fine-grained token:
  only the project repositories, Contents and Pull requests read/write, nothing else, an
  expiry. Branch protection on `main`; the token cannot bypass it. A leaked token can push
  branches and open PRs in those repositories, nothing more. `gh` instead of a push action
  behind `orq`: simpler, and the risk is small.
- Guard hook (`orq guard`, PreToolUse, `packages/cli/src/guard/`). `decide()` is plain TS (no Effect,
  no `bun:*`) and decides allow / block; a shell parser splits commands, also inside
  `bash -c`, `eval` and over several lines. `packages/cli/src/main.ts` starts it without the Effect CLI. Tests: `test/guard.test.ts`. Active only when `ORQ_TASK` is set, which
  `orq new` / `orq resume` do for task sessions; other sessions are not affected.
  - G1 protect base: no push, merge or commit on the base branch; no force push; no
    `gh pr merge`.
  - G2 secrets: no reading or writing `.env*`, keys, credential files, token files.
  - G3 stay inside: file writes and git writes only inside the task worktree; no
    `git worktree add/remove`.
  - G4 destructive: `rm -r`, `find -delete`, `git clean`, `git reset --hard` only inside
    the worktree.
  - They stop mistakes; they are not a security boundary.
- Deny rules for secret files in the user settings (`~/.claude/settings.json`). Claude
  Code enforces them itself, in every session, also outside task sessions.
- Later: a check for API keys written into files (gitleaks covers it in verify).

## 7. Evals (after the first manual run)

Cases in `evals/`, each against a small fixture repo after `orq init`, with a baseline
without orqestrai. The harness: `claude plugin eval`, now that orqestrai is a plugin. Priority 1: **principle skills load** when a step names them.
Then: neutral research, question format, no self-approval, approval moves on, git rules.
Later, promptfoo or similar tools for prompt-level comparisons.

## 8. Not in v1

Fleet-level orchestrator, automatic merge, formal verification, metrics/tracing,
playbooks per work type, self-improvement, TesterArmy
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
- No external project yet: orqestrai itself is built first. `verify-<surface>` comes at
  onboarding (§5).

Settled 2026-11-02:

- Install with Bun + `orq init`, not a plugin; Claude Code only (§4). Changed 2026-11-09:
  a compiled `orq` binary and a Claude Code plugin (§4). Changed 2026-11-17: the
  `orqestrai` npm package (CLI and server) and the plugin, installed on their own; orq
  knows no machines (one `server` setting); one config file; SQLite again, in place of
  Postgres; how verify runs the app is the project's `verify-<surface>` skill (§4, §5).
- Guard hook in TS (§6).
- Triage: checks for existing work and the out-of-scope notes, a recommendation first, grilling
  as a design tree; no acceptance criteria in the brief (§3.0, §3.1).
- Plan: grill first, confirm seams, then write `SPEC.md` as a synthesis (§3.2).
- Test levels and rules (§3.3); gate tiers (§3.4). Changed 2026-11-18: the e2e suite is e2e-inc/e2e's,
  named by the verify skill, not orq's config (`[e2e]` and the `e2e` command are gone);
  agent steps on the subscription (`claudeCode`), the replay cache committed, screenshots
  in the PR, videos out of git (§3.4, §5).
- No needs-info / ready-for-human outcomes: triage goes deep enough instead.

Open:

1. **Build order.** Slice 1 (`orq new`, triage → plan) is done. **Slice 2** (settled
   2026-11-04): impl, plus verify with the quality gate, the verifier and the reviewer,
   and the loop back to impl. Tried first on a small local sandbox project (a Bun HTTP
   API with SQLite), with a `verify-sandbox` skill written by hand; the generator for
   `verify-<surface>` comes later. orqestrai is not run on itself; orqestrai expertise
   skills come later. **Slice 3** (settled 2026-11-05): learn and ship, `orq clean`,
   `MERGED` read from `gh`, verify skills per surface. It comes before the adversary,
   because without ship the whole flow cannot run on a real project. **Slice 4**
   (settled 2026-11-05): e2e-first verify (the verifier writes and runs e2e tests; kinds
   `e2e` / `driven` / `manual`; one level per behavior; impl never changes e2e tests),
   verify slots with wait, expiry, keep and serve (removed 2026-11-16: not needed; the
   verifier takes free ports). The adversary is later and optional,
   for risk `high` only. Then Slack, the dashboard.
2. ~~Modeling toolbox~~: settled 2026-11-02 (§3.7).
3. ~~Test guidelines~~: settled 2026-11-03 (§3.3), written in
   `plugin/skills/principles/principle-test-behavior/GUIDELINES.md`.
4. **GitHub and CI.** orqestrai is public on GitHub (`saculo/orqestrai`, MIT), `main` is
   protected (CI must pass, no force push). `.github/workflows/ci.yml` runs on every pull
   request and push to `main`:

   | Job step | Why |
   |----------|-----|
   | Bun 1.4.4, `bun install --frozen-lockfile` | same toolchain as local; lockfile drift fails |
   | `bun run check` (tsc) | types |
   | `bunx biome ci .` | lint and format |
   | `bun test` (CLI, guard, init) | behavior |
   | module size: a warning above ~150 lines | principle 6 |
   | gitleaks (whole history) | no secrets in the repo |
   | Opengrep with the TypeScript, JavaScript, bash and GitHub Actions rules | static analysis |
   | actionlint | the workflow itself |

   Rules: actions pinned by commit SHA, tools by version (Opengrep also by SHA-256, its
   rules by commit), only versions at least two weeks old, `permissions: contents: read`,
   a newer run on the same branch cancels the older one.

   Later: **evals** with a real model, as a manual `workflow_dispatch` job (cost, an API
   key secret); **AI review** of pull requests (CodeRabbit as a GitHub App needs no secret
   for a public repo; PR-Agent runs as an Action with our own model key); npm publishing
   of the package on each tag (settled 2026-11-17, §4).

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
