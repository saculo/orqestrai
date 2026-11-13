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

  Kinds: `e2e` (a committed test in the project's e2e module; the default), `driven`
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
and it stays in the project's e2e module as a regression test. A check that cannot be a
test is driven by hand. Only what no agent can judge goes to you. Nothing is proven twice.

One round:

```
1. Quality gate     [commands] types, lint, test (unit / integration / contract); no app
2. orq slot take    in the background, waits up to 15 min; then WAITING FOR ME
3. In parallel:
   Verifier (never reads source)            Reviewer (never runs the app)
     starts the app once, in the slot         reads diff + SPEC
     e2e:    writes the test (round 1) or     hypotheses first, Spec + Standards
             reruns it (round 2+), runs it    ≥75 confidence, max 5
     driven: drives the app, keeps evidence   round 2+: prior findings
     manual: not run; goes to you at the PR
4. Commit the e2e tests (failing ones too); keep or free the slot
5. VERIFY.md: failing items → impl (max 3 rounds), else passed → learn
```

- **Verifier** (Sonnet). Does not read the app's source, its other tests or the diff
  (prompt rule). Reads the `verify-<surface>` skills (§5), the e2e module and
  `.orqestrai/testing.md`. When a new e2e test fails, it drives that step by hand once:
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

The quality gate runs the commands in `.orqestrai/config.toml`, except `e2e`, which the
verifier runs against the app:

```toml
[commands]
types = "bun run check"
lint  = "bunx biome ci ."
test  = "bun test"
e2e   = "bun test e2e/"

[e2e]
dir = "e2e/"
```

Any command not set is skipped and reported as "not configured". It is never guessed,
and a missing command never fails the gate. With no `[e2e] dir`, e2e checks are driven
by hand and the round says "no e2e module".

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
4. Push the task branch, `gh pr create --body-file PR.md`, `orq link <id> gh-pr <url>`,
   `WAITING FOR ME`.

After that: **merge is yours.** `orq ls` / `orq show` ask `gh` for the state of each open
task's PR and set `MERGED` when it is merged (no webhook, no daemon; when `gh` fails, the
task stays as it is). Changes you ask for at the PR go through impl → verify → ship again,
which updates the body with `gh pr edit`.

`orq clean <id>` (you run it; the guard blocks it in a task session) removes the
worktree and the local branch of a `MERGED` or `DROPPED` task. The task row, its links and
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

orq does not care where it runs. The pieces:

- **Task sessions**: Claude Code with the `orq` plugin, one per task, sandboxed (Fence),
  on the machine you work from or on a server. They hold no credential.
- **`orq serve`**: the one process with the database login. Clients reach it through
  `ORQ_SERVER`. It can run on the same machine (a Unix socket) or on another one (TCP over a
  private network).
- **The Slack bridge**, beside the sessions, outside the sandbox.
- **Previews** of the app under test, deployed by whatever hosts them (below).

On a laptop all of this is one machine. How I host it (two VPSes, k3s, Argo CD, OpenBao,
Tailscale) is in its own repository, saculo/orqestrai-infra, with the machine setup kept
private; orqestrai itself ships only the binary, the plugin and an image of `orq serve`
(`ghcr.io/saculo/orqestrai`).

- One **zellij tab per task**: the session orchestrates its own task, and you can attach
  to it at any time. No fleet-level agent in v1.
- Each task has its own **git worktree**, created before any step.

### The `orq` CLI

TypeScript on Bun, with Effect 4 (`src/`). Rule: **the code does mechanics only** —
ids, state, worktrees, tabs, Slack, slots. Routing, gates and step order stay in the
skills. Size budget: about 150 lines per module. `src/domain.ts` is the one definition of
steps, statuses and task fields. Tests drive the CLI (`test/`).

Install: two pieces from one repository, one version.

- **The `orq` program**: one executable (`bun build --compile`, Bun inside) with the CLI
  and `orq serve`. A tag `v<version>` builds it, runs the whole test suite against
  the file, and attaches it to a GitHub release (`.github/workflows/release.yml`). The same
  file runs everywhere; only the command differs. One program, so client and server always
  agree on the API (`src/api.ts`).
- **The Claude Code plugin `orq`** (`plugin/`; the repository is its marketplace,
  `.claude-plugin/marketplace.json`): the skills, the agents and the guard hook. Installed once per machine, `claude plugin install orq@orqestrai`.
  Skills and agents are named `orq:<name>` (`/orq:task`); the folder name is the name.
  `test/plugin.test.ts` checks that every `orq:<name>` mentioned exists.

`orq init` writes only what a project owns: `.orqestrai/config.toml`, if missing. State
goes through Effect's `SqlClient` (`@effect/sql-pg`).

| Command                    | Does                                                        |
|----------------------------|-------------------------------------------------------------|
| `orq init`                 | creates `.orqestrai/config.toml`                            |
| `orq guard`                | the PreToolUse guard hook (§6)                              |
| `orq new "<request>"`      | task id, task row, worktree, branch, zellij tab             |
| `orq open <id>`            | opens the task's tab again (after a restart)                |
| `orq state <id> <step> <status> [note]` | updates the task row, adds an event            |
| `orq show <id>`            | one task, its links and its last events                     |
| `orq link <id> <kind> <ref> [origin\|related]` | links the task to an outside reference |
| `orq file <id> <NAME>`     | new task file from `templates/`                             |
| `orq ask <id> "<text>"`    | status → WAITING FOR ME, posts to the task's Slack thread   |
| `orq send <id> "<text>"`   | types text into the task's zellij pane                      |
| `orq ls`                   | lists tasks and status; reads merged PRs from `gh`          |
| `orq clean <id>`           | removes a merged or dropped task's worktree and branch      |
| `orq slot take\|keep\|free\|ls` | verify slots (§5)                                    |
| `orq serve --socket <path>` | the state over HTTP (below); the one process with the database password |

**Server and clients.** `orq serve` is the only process that connects to the database. It
offers the `Db` and `Slots` services as an HTTP API (`src/api.ts`, Effect's `HttpApi`), on
a Unix socket or a TCP address. With `ORQ_SERVER` set (the
socket path, or a URL), every other command uses the API's generated client
(`src/remote.ts`) instead of the database, and needs no `PG*` variable. Without it, orq
connects directly, as on a laptop. The server only touches the database and never runs a
command: a slot's stop and serve commands go back to the client, which runs them as its
own user. The client also sends its `ORQ_HOST` with a slot take and list, so the slots are
the sessions' machine's, not the server's; the number of slots, their ports and how long they
last (`ORQ_SLOTS`, `ORQ_PORT_START`, `ORQ_SLOT_TTL`) are set on the server. Where it runs is
up to the hosting (§4 Topology).

Skills and agents reach orq only through the CLI, over Bash. There is no MCP server: one way
in keeps the slot commands, the guard and the tests the same for every caller.

`orq ask` and `orq send` come with the Slack bridge (after slice 4).

### Slack bridge

One long-running process, `orq bridge` (Socket Mode, no open port, no LLM), on the
sessions' machine, outside the sandbox. It holds the Slack token; the sandbox cannot read
it (Fence hides the file, and sessions cannot see other processes).

- `@bot <request>` in a project's channel → `orq new`: a zellij tab with Claude Code, the
  request typed in. The task gets one Slack thread.
- `orq ask <id> "<text>"` (from a session) → the bridge posts it in the thread, status
  WAITING FOR ME. Claude gets an action, never the token.
- Your reply in the thread → the bridge types it into the task's tab (`orq send`). If the
  tab is closed, it reopens the session (`claude --resume`) first.
- `/orq ls`, `/orq show <id>` answer in Slack. Artifacts are read in the dashboard.
- **Git and GitHub:** a fine-grained token per repo, used by `gh` and `git push` outside the
  sandbox; Fence hides `~/.config/gh` from sessions.
- orq pre-trusts each worktree, so the folder trust dialog never blocks.
- Only your Slack user may talk to the bot.

### Files in a project

Everything orqestrai keeps in a project is in one folder, committed with the project.
The skills, agents and hook come from the plugin, not from files in the project.

```
.orqestrai/
  config.toml            base branch, [commands] for the quality gate
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
- Index: one **shared Postgres** database for every machine (`src/pg.ts`).
  `tasks(id, repo, title, branch, worktree, step, status, created_at, updated_at)`,
  `events(seq, task_id, at, kind, detail)`, `task_links(seq, task_id, kind, ref, role)`
  and `slots(host, n, task_id, …)`. Step and status are checked by the database too.
  - Mine is a shared hosted Postgres 18, so it takes none of the servers' RAM or disk.
  - orq reads libpq's `PG*` variables. Only `orq serve` gets them (§6); sessions
    reach the state through it (the CLI). TLS: `PGSSLMODE=verify-ca` with `PGSSLROOTCERT`, the instance's self-signed
    certificate pinned; `require` (the default) only encrypts.
  - Nothing connects until a command needs state, so `orq guard` and `orq init` work
    without a database.
  - The schema is **migrations**: numbered files in `src/migrations/` (`0001_init.ts`, …),
    listed in `src/pg.ts`, run in order by Effect's Migrator and recorded in
    `orq_migrations`. A merged migration is frozen; a change is a new file. The commands
    that use state run pending migrations first; the migrator's table lock keeps parallel
    runs apart. New ids and slot takes each lock their table for one transaction.
  - Tests use a real Postgres in a container (testcontainers), one empty database per
    test. Never the shared instance.
- The task holds only what is orqestrai's own. Everything outside — the GitHub issue,
  the Linear or Jira ticket, the Slack thread, the PR — is a **link**: an open `kind`, a
  `ref` in that system, and a `role` (`origin` = where the request came from, `related`).
  Only the adapter that owns a kind reads its refs, so a new trigger adds no column.
- Statuses: `TODO`, `IN PROGRESS`, `WAITING FOR ME`, `BLOCKED`, `DROPPED` (triage decided not to do it), `MERGED`.
- Archive: `~/.orqestrai/archive/<repo>/<id>/`, the files of dropped tasks after
  `orq clean`.
- Dashboard: a small web app that reads the database, served over Tailscale only.

## 5. Verification environment

### The `verify-<surface>` skills (one per surface)

A surface is a part of the app that a check drives: `api`, `web`, `cli`. A project with
one surface has one skill, named after that surface (`verify-api` for an API). Each check in the verification plan names its
surface; the verifier loads only the skills of the surfaces in the task. The skill is a
**driver's manual, not a test list**: what to check is in the task's `SPEC.md`, the
committed e2e tests are in the project's e2e module. Plan asks you when a surface in the
plan has no skill yet. Learn changes a skill only when the way to drive the app changed.

Generated with the approach of pstack `create-verification-skill` (later; written by
hand for now). One skill combines:

- **Launch / Doctor / Cleanup**: start the app from empty data, check it is usable,
  tear down what the run started.
- **Drive**: Playwright for web (later: TesterArmy `e2e` for plain-language steps with
  cached replay), a PTY for CLI, HTTP for APIs.
- **Evidence**: screenshots, transcripts, responses. **Visual comparison**: Playwright
  `toHaveScreenshot()`, baseline from `main`, treatment from the branch.
- **Feature map**: one file per user-facing feature — how to reach it, how to drive it,
  which end state proves it works.

### Preview environments

The app under test runs as a **preview per PR**, deployed by the hosting, not by orq.

- **Trigger:** verify needs a running app, so the branch is pushed and a **draft PR**
  opened. The project's CI builds its image.
- **Deploy:** the hosting deploys the PR's image and removes it when the PR closes (mine:
  an Argo CD ApplicationSet with the pull-request generator, in orqestrai-infra).
- **Where:** a naming convention in the project's `.orqestrai/config.toml`, e.g.
  `preview_url = "https://app-pr-{pr}.<tailnet>.ts.net"`. orq fills in the PR number.
- **Right version:** the app serves `/version` with its git SHA. Verify waits until it
  equals the task's commit, so it never tests an old deploy.
- **Secrets of the app:** the hosting's (test or sandbox keys only); sessions never see them.
- **Who runs e2e:**
  - **verify:** the verifier runs and fixes the e2e tests and the driven checks against
    the preview URL (Playwright, through the sandbox proxy). The evidence is written
    straight into `.orqestrai/tasks/<id>/evidence/`.
  - **ship:** marking the PR ready runs the committed e2e suite in CI against the
    preview. That is the merge gate; nobody can skip it.
- **What a project needs for previews:** a Dockerfile, a `/version` endpoint, a CI
  workflow that builds the image, `preview_url`, and its entry in the hosting.
- **Until previews exist:** the verify slots of slice 4 stay (`orq slot take|keep|free|ls`,
  a row per `ORQ_HOST` in the database, the app started by the `verify-<surface>` skill).
  They go away once previews work.

The `verify-<surface>` skills are generated when a project is onboarded into orqestrai, not
before.

## 6. Security

The rule: **an agent can use what it needs but cannot read a secret.** A process that uses
a secret holds it in plain text, and anything running as the same user can read it. So
agents get actions (orq's API), never credentials, and the database login is only in
`orq serve`, best on another machine than the sessions.

- **Sessions** run in Fence (bubblewrap): its own network allowlist, files, and process
  namespace. They hold no database login: they reach orq's state through `orq serve`
  (`ORQ_SERVER`), which runs no command, so a session cannot make it run its code.
  - `orq` should be a root-owned binary, so a session cannot replace it, and the Fence
    config read-only inside the sandbox.
  - Allowed network: GitHub, Anthropic, `orq serve`, the Docker socket (testcontainers,
    rootless Docker as its own user) and the preview URLs. Everything else is blocked.
  - The tokens of the processes beside the sessions (the Slack bridge, `gh`) are in files
    Fence hides; inside Fence, other processes are invisible (checked on VPS1).
- **`orq serve`** gets the Postgres login and nothing else does. TLS to a shared instance
  pins its self-signed certificate (`PGSSLMODE=verify-ca`).
- My hosting (orqestrai-infra): `orq serve` in k3s, non-root and read-only, its login from
  OpenBao through External Secrets, reachable only over Tailscale from the sessions'
  machine, and network policies that let it reach only the database.
- GitHub: fine-grained token per repo. Branch protection on `main`; the token cannot
  bypass it.
- Guard hook (`orq guard`, PreToolUse, `src/guard/`). `decide()` is plain TS (no Effect,
  no `bun:*`) and decides allow / block; a shell parser splits commands, also inside
  `bash -c`, `eval` and over several lines. `src/main.ts` starts it without the Effect CLI. Tests: `test/guard.test.ts`. Active only when `ORQ_TASK` is set, which
  `orq new` / `orq open` do for task sessions; other sessions are not affected.
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
  a compiled `orq` binary and a Claude Code plugin (§4).
- Guard hook in TS (§6).
- Triage: checks for existing work and the out-of-scope notes, a recommendation first, grilling
  as a design tree; no acceptance criteria in the brief (§3.0, §3.1).
- Plan: grill first, confirm seams, then write `SPEC.md` as a synthesis (§3.2).
- Test levels and rules (§3.3); gate tiers (§3.4).
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
   verify slots with wait, expiry, keep and serve. The adversary is later and optional,
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
   when `bunx orqestrai init` comes.

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
