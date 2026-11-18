---
name: verify
description: orqestrai verify step. Runs the quality gate from config.toml, then runs the verifier (e2e tests and driven checks against one running app, through the verify-<surface> skills, e2e-inc/e2e for the surfaces it drives) and the reviewer in fresh contexts, writes VERIFY.md, and sends failures back to impl at most 3 rounds. Loaded by orq:task; do not run it alone.
---

# orqestrai: verify

Input: the approved `SPEC.md`, the commits on the task branch.
Output: `.orqestrai/tasks/<id>/VERIFY.md`, evidence in `.orqestrai/tasks/<id>/evidence/`,
e2e tests in the project's e2e suite (the one its verify skills name).

Load `orq:principle-prove-it-works`, `orq:principle-escalate-only-decisions`.

Three tiers, in this order: **quality** (deterministic commands), **review** (verifier
and reviewer, fresh contexts), **acceptance** (the user, later at the PR).

## 0. The round

First round: run `orq file <id> VERIFY`. Later rounds: add a new `## Round <n>` section
under the old ones and set `round: <n>` in the frontmatter. Old rounds stay.

## 1. Quality gate

Read `[commands]` in `.orqestrai/config.toml`. Run each command that is set, in the
worktree, in this order: `types`, `lint`, `test`, then any other keys. No app runs here:
the e2e suite is the verifier's, against the app.

- Record each one: `pass` or `fail`, and the command with the last lines of its output.
- A command that is **not set** is `not configured`. Do not guess one, and do not fail
  the gate for it. Report the list once at the end.
- A `fail` is a failing item. Still run the review: one round should find as much as it
  can.

## 2. Verifier and reviewer, at once

Start both subagents in one message. Each gets only what is listed here.

**`orq:verifier`**: one subagent for all `e2e` and `driven` checks, on one running app.
Group the checks by **Surface**. Each surface has a driver skill,
`.claude/skills/verify-<surface>/`.

```
Task: <id>
Verify skills: verify-<surface> (V1, V2), verify-<surface> (V3)
Round: <n>. Existing e2e tests of this task: <round 2+: their files; else "none">
Notes on e2e tests from impl: <round 2+: gaps impl reported about a test; else "none">
Evidence folder: .orqestrai/tasks/<id>/evidence/
Checks (from SPEC.md, Verification plan):
<each row: Check, Claim, Surface, Kind, How, Evidence expected>
Acceptance criteria:
<the AC lines the checks name>
```

No code, no diff, no task list, no impl reports. A check whose surface has **no verify
skill** is not sent: it is `INCONCLUSIVE` with "no verify-<surface> skill". When a
surface's skill names no e2e suite, its `e2e` checks are run as `driven`, and the round
reports "no e2e suite for <surface>".
Manual checks are not sent; they wait for the user at the PR.

**`orq:reviewer`**:

```
Diff: <base>..HEAD (worktree <path>)
Spec: .orqestrai/tasks/<id>/SPEC.md
Prior findings: <round 2+: the findings table of the round before; else "none">
```

Nothing else: not the impl reports, not the verifier's results.

## 3. After the verifier

- **E2E tests:** commit the files the verifier wrote or changed in the e2e suite, and
  its replay cache (e2e: `.e2e/cache/`), also when they fail (they are the spec of the
  check): `test(<id>): e2e for AC1, AC2`. Nothing outside the e2e suite, its cache and
  the evidence folder may change. Revert anything else.
- **Evidence:** keep the screenshots, the trace pages (`trace.md`) and `report.json`.
  Videos stay out of git (they would stay in the history for good): make sure
  `.gitignore` has `.orqestrai/tasks/*/evidence/**/*.webm`; add the line when it does not.
- **The app:** the verifier stops what it started. If it reports an app still running,
  stop it with the stop command it gives.

## 4. Write the round

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

## 5. Decide

- **A missing skill** (any check, whatever else happened): the round cannot pass. Finish
  the round as below, but instead of passing, ask (`orq:task`, Messages): headline
  `**No verify-<surface> skill for V3**`, and a question: write the skill (then run verify
  again), or change the check to `manual` in `SPEC.md` (then it is theirs at the PR).
- **No failing items:** `status: passed`. Continue with the next step of the task's playbook.
- **Failing items, round < 3, and no root cause repeated from the round before:**
  `status: failed`, outcome "back to impl: <items>". Run
  `orq state <id> impl "IN PROGRESS" "verify round <n>: <count> items"` and continue
  with `orq:impl` round 2+.
- **Round 3 failed, or a root cause repeated:** `status: escalated`. Run
  ask (`orq:task`, Messages): the round's verdicts as the list, the repeated cause, and a
  question: change the spec, accept a risk, or one more round with a different approach.

  ```
  **Verify round 3: 2 of 5 checks fail, I'm stopping**
  - ✅ V1 AC1 a booked slot cannot be booked again
  - ❌ V3 AC3 expected "cancelled", saw an error page
  - ❌ quality gate: lint, 2 errors in src/booking.ts
  - Repeated cause: check:V3:POST /bookings/:id/cancel 500

  **Q<n> - How do we go on?** <the options>
  - Recommended: one more round on V3 - the error is in one handler
  ```

Commit `VERIFY.md` and the evidence: `docs(<id>): verify round <n>`.

## Never

- Read the implementer's reports into the verifier's or the reviewer's prompt.
- Fix code here. Verify finds; impl fixes.
- Mark a check passed that the verifier did not mark `VERIFIED`.
- Pass a round with a check that nobody ran.
- Leave an app running when verify stops.
