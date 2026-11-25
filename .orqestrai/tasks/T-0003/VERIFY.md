---
id: T-0003
status: failed
round: 1
---

# Verify: backlog, orq start, the GitHub label trigger and orq watch

## Round 1

### Quality gate
One component: the repository root (`AGENTS.md`, `## Checks`). Run on the tree of `ec956bd`.

| Command | Result | Evidence |
|---------|--------|----------|
| `bun run check` | pass | `tsc --noEmit`, no output |
| `bunx biome ci .` | pass | `Checked 83 files … No fixes applied.` |
| `bun test` | pass | `--timeout 60000` (.orqestrai/testing.md: 5 s timeouts on this loaded machine are not failures): `189 pass, 0 fail, Ran 189 tests across 15 files. [626.86s]` |

Not configured: none.

### Checks (verifier)
No `e2e` or `driven` checks in the plan: the verifier was not started.

| Check | Claim | Verdict | Evidence |
|-------|-------|---------|----------|
| V1 | AC1-AC9 | VERIFIED | B1-B22 in `bun test` pass (gate above); the reviewer found a test for each at its seam |
| V2 | AC10 | VERIFIED | actionlint (the digest-pinned image CI uses) exit 0 over all workflows; README, DESIGN.md, GLOSSARY.md, ADR-0002 in the diff |
| V3 | AC5 | manual | the user, at the PR |
| V4 | AC6-AC8, AC10 | manual | the user, at the PR |

### Review (reviewer)
**Hypotheses:** (1) claim/unstart could leave a task half started — not confirmed; (2) two
concurrent issue events could add two tasks — not confirmed (`BEGIN IMMEDIATE`); (3) the
trigger port could leak routes or compare the token badly — not confirmed, one gap (R2);
(4) the 0004 rebuild could cascade-delete children — not confirmed; one null-worktree reader
missed (R1).

**Prior findings:** none (round 1).

| # | Axis | Finding | Confidence | Blocking | Where |
|---|------|---------|------------|----------|-------|
| R1 | Spec | `orq clean` of a dropped GitHub task that never started fails: its `repo` is the GitHub name, and clean runs git there (`orq: cannot run git: NotFound: FileSystem.access (saculo/meal-prep)`). The spec says it removes nothing and works. No test. | 90 | yes | packages/cli/src/clean.ts:61 |
| R2 | Standards | The trigger endpoint accepts any `repo`; one starting with `/` is taken as a checkout by `orq start`, so a token holder can bypass `[github] repos` and start a session in any local folder. AC7 says the repo's GitHub name: check `owner/name` at the endpoint and in `addFromIssue`. | 80 | yes (raised by the orchestrator: a way round the allow-list on the one internet-facing route) | packages/server/src/trigger.ts:11, packages/cli/src/task.ts:56 |

### Outcome
back to impl: R1, R2.

Root causes:
- review:R1:packages/cli/src/clean.ts:61
- review:R2:packages/server/src/trigger.ts:11

## For the PR body
- Many CLI tests now run `orq new` and `orq start` (two processes); on a loaded 1-CPU machine more of them pass bun's 5 s default only with `--timeout 60000` (as .orqestrai/testing.md says for main too).
