<!-- orqestrai T-0002. Written by ship from the task files in .orqestrai/tasks/T-0002/. -->

## What and why
A task session could start with no Herdr space label and no message, so the app showed no tab and only `hc attach` reached it. meal-prep T-0001 hit this because the installed `orq` predated the label code (#35), and both builds said v0.9.0. Also, every task worktree stopped at Claude's "trust this folder" dialog: DESIGN.md said orq pre-trusts worktrees, but no code did. Now a session starts only in the project's space (`herdr_session`, else the repo's directory name), orq says so when it cannot, and each worktree is pre-trusted.

## Acceptance criteria
- [x] **AC1** The project's space is `herdr_session`, else the repo's directory name; a new session gets that space's label, never another space's. V1 `VERIFIED`: B1, B2 in test/herdr.test.ts.
- [x] **AC2** Space not open: `orq new` / `orq resume` keep the task, start no session, name the space, say to open it and run `orq resume <id>`, exit non-zero; `orq issues` still comments and goes on. V1 `VERIFIED`: B3-B5 (test/herdr.test.ts, test/issues.test.ts).
- [x] **AC3** hc failing or printing unreadable output stops orq with hc's message; no hc prints the hand command as before. V1 `VERIFIED`: B6, B7.
- [x] **AC4** orq inside a Fence task session reaches herdr-core (`HC_TERMINAL_SOCKET` passed as `HC_SOCKET`). V1 `VERIFIED`: B8.
- [x] **AC5** `orq resume` labels a running task terminal that has no space label; a labelled one is left alone. V1 `VERIFIED`: B9, B10.
- [x] **AC6** `orq new` / `orq resume` mark the worktree trusted in Claude's config, keeping every other entry, the file's mode and a symlink; cleaning a task removes the entry. V1 `VERIFIED`: B11-B13 and the R1 tests.
- [x] **AC7** DESIGN.md and README describe the project space, space not open and pre-trust; the version is main's 0.10.0 (no bump here, Q16: released later). V2 `VERIFIED`: B14, the docs diff.

## For you to check
Run with this branch's `orq` (`bin/orq` from the checkout, or install it), not the old global install.
- [ ] **V3** (AC1, AC5): with an `orqestrai` space open in the Herdr app, `orq new "check"` from any terminal: a tab for the task appears in that space; `orq resume <id>` changes nothing.
- [ ] **V4** (AC2): with no terminal open in the project's space (or `herdr_session` set to an unopened name), `orq new "check"`: the message names the space and no tab appears; open the space, `orq resume <id>`: the tab appears.
- [ ] **V5** (AC4, AC6): with `ORQ_SANDBOX='fence --'`, `orq new "check"`: the session goes straight to `/orq:task`, with no "trust this folder" dialog.

## Verify
Rounds: 2. Quality gate: types pass, lint pass. `bun test` fails a varying few tests at bun's 5 s default timeout (5 after the rebase), on main too; `bun test --timeout 60000`: 165 pass, 0 fail. Opened on the user's word (Q17).
Review: blocking findings fixed: 1 (R1: the trust write made a 600 `~/.claude.json` group-writable and replaced a symlink with a plain file).

## Open findings (not blocking)
- `bun test` with the default 5 s timeout fails a varying set of older CLI tests on a loaded 1-CPU machine, on main too; not changed here.
- Below the review's bar: a dangling symlink at `~/.claude.json` is replaced by a plain file (`existsSync` is false for it).

## Learn
- **L1** ADR: orq writes the folder-trust entry into Claude's config: docs/adr/0001-orq-writes-claude-trust-entries.md.
- **L2** Glossary: Herdr space, project's space, task session: GLOSSARY.md.
- **L3** Testing notes: timeouts on a loaded machine, the fake hc, the Claude config isolation: .orqestrai/testing.md.

## Decisions
- No fallback space: not the space orq runs in, not any open space (Q2).
- A space that is not open keeps the task and its worktree; `orq resume` starts it later (Q8).
- Pre-trust writes `projects[<worktree>].hasTrustDialogAccepted` in Claude's config, through a temp file and a rename; a file that is not valid JSON is left alone (Q6, ADR 0001).
- No version bump in this PR (Q16).

## Risk
medium: orq rewrites one entry of `~/.claude.json`, a file running Claude sessions also write; a write at the same instant could lose one update (accepted). Blast radius: every task start now fails loudly where it used to start silently.
