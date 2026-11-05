---
name: orq-verify
description: orqestrai verify step. Runs the quality gate from config.toml, takes a verify slot, then runs the verifier (e2e tests and driven checks against one running app, through the verify-<surface> skills) and the reviewer in fresh contexts, writes VERIFY.md, and sends failures back to impl at most 3 rounds. Loaded by orq-task; do not run it alone.
---

# orqestrai: verify

Input: the approved `SPEC.md`, the commits on the task branch.
Output: `.orqestrai/tasks/<id>/VERIFY.md`, evidence in `.orqestrai/tasks/<id>/evidence/`,
e2e tests in the project's e2e module.

Load `orq-principle-prove-it-works`, `orq-principle-escalate-only-decisions`.

Three tiers, in this order: **quality** (deterministic commands), **review** (verifier
and reviewer, fresh contexts), **acceptance** (the user, later at the PR).

## 0. The round

First round: run `orq file <id> VERIFY`. Later rounds: add a new `## Round <n>` section
under the old ones and set `round: <n>` in the frontmatter. Old rounds stay.

## 1. Quality gate

Read `[commands]` in `.orqestrai/config.toml`. Run each command that is set, in the
worktree, in this order: `types`, `lint`, `test`, then any other keys **except `e2e`**
(the verifier runs that one, against the app).

- Record each one: `pass` or `fail`, and the command with the last lines of its output.
- A command that is **not set** is `not configured`. Do not guess one, and do not fail
  the gate for it. Report the list once at the end.
- A `fail` is a failing item. Still run the review: one round should find as much as it
  can.

## 2. Take a verify slot

Only when the plan has `e2e` or `driven` checks. Run, **in the background**:

```
orq slot take <id> --wait 900
```

You are woken when it ends. It prints `ORQ_SLOT`, `ORQ_PORT_BASE` and `ORQ_PROJECT`.
If it fails after 15 minutes: `orq state <id> verify "WAITING FOR ME" "verify slot held
by <task>"`, tell the user, and stop. When the user says to retry, take it again.

## 3. Verifier and reviewer, at once

Start both subagents in one message. Each gets only what is listed here.

**`orq-verifier`**: one subagent for all `e2e` and `driven` checks, on one running app.
Group the checks by **Surface**. Each surface has a driver skill,
`.claude/skills/verify-<surface>/`.

```
Slot: ORQ_SLOT=<n> ORQ_PORT_BASE=<port> ORQ_PROJECT=<name>
Verify skills: verify-<surface> (V1, V2), verify-<surface> (V3)
E2E module: <[e2e] dir, or "none">. E2E command: <[commands] e2e, or "none">
Round: <n>. Existing e2e tests of this task: <round 2+: their files; else "none">
Notes on e2e tests from impl: <round 2+: gaps impl reported about a test; else "none">
Keep the app running at the end: <yes when this round can pass and the plan has manual checks; else no>
Evidence folder: .orqestrai/tasks/<id>/evidence/
Checks (from SPEC.md, Verification plan):
<each row: Check, Claim, Surface, Kind, How, Evidence expected>
Acceptance criteria:
<the AC lines the checks name>
```

No code, no diff, no task list, no impl reports. A check whose surface has **no verify
skill** is not sent: it is `INCONCLUSIVE` with "no verify-<surface> skill". With no
e2e module, `e2e` checks are run as `driven`, and the round reports "no e2e module".
Manual checks are not sent; they wait for the user at the PR.

**`orq-reviewer`**:

```
Diff: <base>..HEAD (worktree <path>)
Spec: .orqestrai/tasks/<id>/SPEC.md
Prior findings: <round 2+: the findings table of the round before; else "none">
```

Nothing else: not the impl reports, not the verifier's results.

## 4. After the verifier

- **E2E tests:** commit the files the verifier wrote or changed in the e2e module, also
  when they fail (they are the spec of the check): `test(<id>): e2e for AC1, AC2`.
  Nothing outside the e2e module and the evidence folder may change. Revert anything else.
- **The slot:** if the verifier kept the app running, and the round passes, run
  `orq slot keep <id> --stop "<the stop command it reported>" --port <port>`. Otherwise
  run `orq slot free <id>`.

## 5. Write the round

Fill the round in `VERIFY.md` from the reports: the gate table, the checks table, the
review (hypotheses, prior findings, findings). Check one or two pieces of evidence
yourself; a report is a claim.

**Failing items:** each gate `fail`, each `NOT VERIFIED` check, each blocking finding.
`INCONCLUSIVE` is not a pass: when it comes from the app not starting, it is a failing
item. When a surface has no verify skill, the check was never run, and impl cannot fix
that: it is a **missing skill**, see Decide.

Non-blocking findings go to **For the PR body**. Do not notify the user about them.

**Root causes:** one line per failing item: `<tier>:<kind>:<first location>`, for
example `quality:test:src/orders.ts:42` or `check:V2:POST /orders 500`. Compare with the
round before.

## 6. Decide

- **A missing skill** (any check, whatever else happened): the round cannot pass. Finish
  the round as below, but instead of passing, run `orq state <id> verify "WAITING FOR ME"
  "no verify-<surface> skill for V3"` and ask the user: write the skill (then run verify
  again), or change the check to `manual` in `SPEC.md` (then it is theirs at the PR).
- **No failing items:** `status: passed`. Continue with the next step in `orq-task`.
- **Failing items, round < 3, and no root cause repeated from the round before:**
  `status: failed`, outcome "back to impl: <items>". Run
  `orq state <id> impl "IN PROGRESS" "verify round <n>: <count> items"` and continue
  with `orq-impl` round 2+.
- **Round 3 failed, or a root cause repeated:** `status: escalated`. Run
  `orq state <id> verify "WAITING FOR ME" "<one line>"` and tell the user, in a few
  lines: what passed, what still fails, the repeated cause, and your recommendation
  (change the spec, accept a risk, or one more round with a different approach).

Commit `VERIFY.md` and the evidence: `docs(<id>): verify round <n>`.

## Never

- Read the implementer's reports into the verifier's or the reviewer's prompt.
- Fix code here. Verify finds; impl fixes.
- Mark a check passed that the verifier did not mark `VERIFIED`.
- Pass a round with a check that nobody ran.
- Leave a slot taken when verify stops, except a kept one.
