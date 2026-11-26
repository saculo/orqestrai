---
id: T-0003
status: applied
---

# Learn: the task's repo has two forms; watch tests; orq init stays small

<!-- status: draft | applied. Every proposal is already applied in the task branch; the
user accepts it by merging the PR, or asks to drop it. -->

## What happened
Two verify rounds. Round 1 had two blocking findings, and both came from the same source: a
task's `repo` is now either a GitHub name (before start) or a checkout path (after start).
R1: `orq clean` ran git in `saculo/meal-prep`. R2: the endpoint took any `repo`, so a path
got past `[github] repos`. Round 2 passed. In plan the user said no to `orq init` writing the
workflow caller (Q14). More CLI tests now need `--timeout 60000`, and the watch tests added a
long-running-process pattern.

## Proposals
| # | Kind | Change | Evidence in this task | Applied in |
|---|------|--------|-----------------------|------------|
| L1 | glossary | Add "Task repo": the GitHub name before start, the checkout path after it. Check that it is a path before running git there. | VERIFY round 1 R1 and R2 (both root causes); SPEC agent decision on `repo` | `GLOSSARY.md` |
| L2 | out-of-scope | `orq init` does not write the workflow caller, the automation file or the secrets. | SPEC Q14 (user: no) | `.orqestrai/out-of-scope/orq-init-writes-workflow.md` |
| L3 | testing | The timeout note now names the cause (tests that run several `orq` processes), not two files. | VERIFY "For the PR body"; round 1/2 gates ran with `--timeout 60000` | `.orqestrai/testing.md` |
| L4 | testing | Note how to test long-running commands (spawn, poll with a deadline, kill in `afterEach`), plus `ORQ_WATCH_RETRY` and `startServer`'s `triggerPort`. | SPEC B17-B20 pattern; Impl note W4.1; `test/watch.test.ts`, `test/server.ts` | `.orqestrai/testing.md` |

## Considered, not proposed
- ADR for the trigger transport: ADR-0002 already covers it in this diff.
- Glossary entries for backlog, start, automation, trigger and watch: already added in this diff.
- An agent rule to "check every reader when a column becomes nullable" (R1): it showed up in one round only, and the reviewer caught it. L1 covers the specific trap.
- Foreign keys on after migrations (W1.1 impl note): it is in the code and only matters for table rebuilds. Too narrow for now.
- No verify skill: the verifier was not started (no e2e/driven checks).
