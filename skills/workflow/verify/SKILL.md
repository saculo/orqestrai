---
name: orq-verify
description: orqestrai verify step. Runs the quality gate from config.toml, then the verifier and the reviewer in fresh contexts, writes VERIFY.md, and sends failures back to impl at most 3 rounds. Loaded by orq-task; do not run it alone.
---

# orqestrai: verify

Input: the approved `SPEC.md`, the commits on the task branch.
Output: `.orqestrai/tasks/<id>/VERIFY.md`, evidence in `.orqestrai/tasks/<id>/evidence/`.

Load `orq-principle-prove-it-works`, `orq-principle-escalate-only-decisions`.

Three tiers, in this order: **quality** (deterministic commands), **review** (verifier
and reviewer, fresh contexts), **acceptance** (the user, later at the PR).

## 0. The round

First round: run `orq file <id> VERIFY`. Later rounds: add a new `## Round <n>` section
under the old ones and set `round: <n>` in the frontmatter. Old rounds stay.

## 1. Quality gate

Read `[commands]` in `.orqestrai/config.toml`. Run each command that is set, in the
worktree, in this order: `types`, `lint`, `test`, then any other keys.

- Record each one: `pass` or `fail`, and the command with the last lines of its output.
- A command that is **not set** is `not configured`. Do not guess one, and do not fail
  the gate for it. Report the list once at the end.
- A `fail` is a failing item. Still run the review: one round should find as much as it
  can.

## 2. Verifier and reviewer, at once

Start both subagents in one message. Each gets only what is listed here.

**`orq-verifier`**, if the project has a verify skill (`.claude/skills/verify-*`):

```
Verify skill: <verify-name>
Evidence folder: .orqestrai/tasks/<id>/evidence/
Checks (from SPEC.md, Verification plan):
<each row: Check, Claim, Kind, How, Evidence expected>
Acceptance criteria:
<the AC lines the checks name>
```

No code, no diff, no task list, no impl reports. With **no verify skill**, do not start
the verifier: every check is `INCONCLUSIVE` with "no verify skill for this project".
Manual checks (Kind = manual) are not sent; they wait for the user at the end.

**`orq-reviewer`**:

```
Diff: <base>..HEAD (worktree <path>)
Spec: .orqestrai/tasks/<id>/SPEC.md
Prior findings: <round 2+: the findings table of the round before; else "none">
```

Nothing else: not the impl reports, not the verifier's results.

## 3. Write the round

Fill the round in `VERIFY.md` from the reports: the gate table, the checks table, the
review (hypotheses, prior findings, findings). Check one or two pieces of evidence
yourself; a report is a claim.

**Failing items:** each gate `fail`, each `NOT VERIFIED` check, each blocking finding.
`INCONCLUSIVE` is not a pass: when it comes from the app not starting, it is a failing
item; when no verify skill exists, report it to the user at the end.

Non-blocking findings go to **For the PR body**. Do not notify the user about them.

**Root causes:** one line per failing item: `<tier>:<kind>:<first location>`, for
example `quality:test:src/orders.ts:42` or `check:V2:POST /orders 500`. Compare with the
round before.

## 4. Decide

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
