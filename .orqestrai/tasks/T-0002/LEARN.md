---
id: T-0002
status: applied
---

# Learn: Claude-config pre-trust as an ADR, Herdr space in a glossary, test timeouts in testing.md

<!-- status: draft | applied. Every proposal is already applied in the task branch; the
user accepts it by merging the PR, or asks to drop it. -->

## What happened
Two verify rounds. Round 1 failed on R1: the atomic rename of `~/.claude.json` lost the
file's 0600 mode and replaced a symlink with a plain file; round 2 passed. In both rounds
`bun test` hit the 5000 ms timeout in a varying set of older CLI tests on the loaded 1-CPU
machine (main too), and the gate had to be read through `--timeout 60000`. The user chose:
no space fallbacks (Q2), loud failure when the space is not open (Q8), pre-trust in Claude's
own config (Q6). Triage had to settle that the app's "session", hc's `where` and
`herdr_session` all mean one Herdr space.

## Proposals
| # | Kind | Change | Evidence in this task | Applied in |
|---|------|--------|-----------------------|------------|
| L1 | adr | Record that orq writes the trust entry into Claude's own config, and the rules for that write (one entry, temp+rename, keep mode and symlink, never overwrite invalid JSON) | BRIEF Q6; SPEC Risk and Design (pre-trust); VERIFY round 1 R1 | docs/adr/0001-orq-writes-claude-trust-entries.md |
| L2 | glossary | Define Herdr space (hc and config say "session"), the project's space and when it is open, and task session | BRIEF Assumptions (space = session); README rename session -> space; SPEC Design "domain word is Herdr space" | GLOSSARY.md |
| L3 | testing | Create the project's testing.md: bun's 5 s timeout flakes on this machine, use `--timeout 60000` before calling a test red; the fake hc (`ORQ_HC`), no-hc, and `CLAUDE_CONFIG_DIR` isolation | VERIFY rounds 1 and 2 quality gate (timeouts both rounds); SPEC Q13 | .orqestrai/testing.md |

## Considered, not proposed
- An agent rule "keep mode and symlinks when replacing a user's file": R1 came up once and
  was fixed; the rule now sits in the ADR where the next change to that file will see it.
- An ADR for "no fallback space, fail loudly": easy to reverse, and DESIGN.md Sessions and
  the glossary already say it.
- Raising bun's default test timeout: that is a change to tests/config, not learn's to make;
  noted in testing.md instead.
- Dangling-symlink `~/.claude.json` (VERIFY "For the PR body"): below the bar, only this task.
- Verify skill: none exists and the verifier was not started (no e2e/driven checks).
