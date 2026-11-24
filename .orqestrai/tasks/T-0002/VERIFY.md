---
id: T-0002
status: passed
round: 2
---

# Verify: task sessions only in the project's Herdr space; worktrees pre-trusted

## Round 1

### Quality gate
Component: the repository root (`AGENTS.md`). Every changed file is in it.

| Command | Result | Evidence |
|---------|--------|----------|
| `bun run check` | pass | `tsc --noEmit`, no errors |
| `bunx biome ci .` | pass | "Checked 73 files … No fixes applied." |
| `bun test` | fail (pre-existing) | 148 pass, 2 fail: "parallel runs never share an id" and "(unnamed)", each at the 5000 ms timeout. The same two fail on the base code (the task's changes set aside with a tagged stash, then restored): the machine has 1 CPU at load ~6. With `bun test --timeout 60000`: 161 pass, 0 fail. Not caused by this task; not a failing item of it. |

### Checks (verifier)
No `e2e` or `driven` checks in the plan: the verifier was not started.

| Check | Claim | Verdict | Evidence |
|-------|-------|---------|----------|
| V1 | AC1-AC6 | VERIFIED | the behavior tests B1-B13 in test/herdr.test.ts, test/issues.test.ts, test/clean.test.ts pass (`--timeout 60000` run: 161 pass) |
| V2 | AC7 | VERIFIED | B14 in test/orq.test.ts passes; DESIGN.md Sessions and README describe the project space, space-not-open and pre-trust |
| V3 | AC1, AC5 | manual | the user, at the PR |
| V4 | AC2 | manual | the user, at the PR |
| V5 | AC4, AC6 | manual | the user, at the PR |

### Review (reviewer)
**Hypotheses:** (1) the trust write can damage Claude's config file; (2) a silent fallback is left in the space lookup; (3) `orq issues` stops or skips the comment when the space is not open; (4) resume of a running terminal checks the wrong label. (1) confirmed in part; (2)-(4) not confirmed.

**Prior findings:** none (round 1).

| # | Axis | Finding | Confidence | Blocking | Where |
|---|------|---------|------------|----------|-------|
| R1 | Standards | The trust write's temp file gets mode 0666 minus the umask and replaces `~/.claude.json` by rename; here the file is 600 and the umask 0002 (checked: `stat` 600, `umask` 0002), so the first `orq new` would make Claude's config group-writable and world-readable. A symlinked `~/.claude.json` would be replaced by a plain file. | 85 | yes | packages/cli/src/trust/index.ts:32-35 |

### Outcome
back to impl: R1.

Root causes:
- review:R1:packages/cli/src/trust/index.ts:32

## Round 2

### Quality gate
| Command | Result | Evidence |
|---------|--------|----------|
| `bun run check` | pass | `tsc --noEmit`, no errors |
| `bunx biome ci .` | pass | "Checked 73 files … No fixes applied." |
| `bun test` | fail (pre-existing, timing) | 145 pass, 8 fail, all in test/orq.test.ts and test/dashboard.test.ts, each at the 5000 ms timeout (`orq new …`, `the playbook …`, `orq create-artifact …`, `orq resume > fails when the worktree is gone`, `parallel runs never share an id`, `(unnamed)`). The set changes from run to run with the machine's load (1 CPU, load ~6); round 1 showed the same timeouts on the base code. `bun test --timeout 60000` right after the fix: 165 pass, 0 fail. Not a failing item of this task. |

### Checks (verifier)
No `e2e` or `driven` checks: the verifier was not started. V1, V2 as in round 1 (V1 now also covers the three tests added for R1); V3-V5 manual, the user at the PR.

### Review (reviewer)
**Hypotheses:** (1) the mode is lost for a temp file left by a crashed run; (2) the temp file sits next to the link, not the target; (3) the new tests pass without the fix. None confirmed.

**Prior findings:** R1 fixed (`packages/cli/src/trust/index.ts:21` edits a symlink's target; `:38-40` keeps the mode, 0600 for a new file; tests in `test/herdr.test.ts:266-300`, run with umask 002).

| # | Axis | Finding | Confidence | Blocking | Where |
|---|------|---------|------------|----------|-------|
| (none) | | | | | |

### Outcome
passed.

Root causes: none (round 1's review:R1 fixed).

## For the PR body
- `bun test` with the default 5 s timeout fails a varying set of older CLI tests on this loaded 1-CPU machine, on main too; with `--timeout 60000` all 165 pass. Not changed here.
- Below the review's bar: a dangling symlink at `~/.claude.json` is replaced by a plain file (`existsSync` is false for it).
