---
id: T-0002
status: draft
risk: medium
---

# Task sessions start only in the project's Herdr space, loudly otherwise; worktrees are pre-trusted

## Open decisions
none.

## Decisions
- Brief decisions Q1-Q11 are in BRIEF.md.
- Q12 Acceptance criteria: AC1-AC7 below, as proposed.
- Q13 Seams: every test runs the real `orq` command with the fake `hc` and a throwaway Claude config dir; no test touches the real `~/.claude.json`.
- Q14 Verification: integration tests for AC1-AC6; the tab in the Herdr app and a Fence session without the trust dialog are manual checks by the user at the PR.

## Acceptance criteria
- **AC1** The project's space is `herdr_session` from `.orqestrai/config.toml`, else the repo's directory name. A new task session gets that space's `herdr.space` label, never the label of another space (not the space orq runs in, not any open space).
- **AC2** When no live terminal is in the project's space: `orq new` creates the task and its worktree, `orq resume` keeps the task; neither starts a session. orq names the missing space and says to open it in the Herdr app, then run `orq resume <id>`, and exits non-zero. `orq issues` prints the same for that issue, still comments on the issue, and goes on with the other issues.
- **AC3** When `hc ls` or `hc get` fails or prints output orq cannot read, orq stops with hc's message and starts no session. When hc is not installed, orq prints the command to start the session by hand, as today.
- **AC4** orq run inside a Fence task session reaches herdr-core: its hc calls use the socket of the terminal it runs in (`HC_TERMINAL_SOCKET`) when no `HC_SOCKET` is set.
- **AC5** `orq resume` on a task whose terminal is running without the project space's label adds the label, and starts nothing. A running terminal that has the label is left as it is. If the space is not open, AC2's message.
- **AC6** `orq new` and `orq resume` mark the task's worktree as trusted in Claude's config (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`: `projects[<worktree>].hasTrustDialogAccepted = true`) before the session starts; every other entry in the file is kept. `orq clean` removes the worktree's entry.
- **AC7** The CLI's version is 0.10.0; DESIGN.md and README describe the project's space, the space-not-open message and the pre-trust.

## Operations
| Operation | Class | Why |
|-----------|-------|-----|
| project space name (config or repo dir) | transformation | reads config and the repo path, changes nothing |
| start a task session (`orq new`, `orq issues`) | integration | the hard part is git + SQLite + hc + Claude's config, and what happens when hc or the space is missing after the task exists |
| `orq resume` (start, or label a running terminal) | integration | coordination with hc: find, label or start; each failure has its own answer |
| pre-trust / un-trust a worktree | integration | read-modify-write of a file Claude owns and running Claude processes also write; the rule (keep every other entry) is simple, the shared file is the risk |
| `orq clean` | integration | unchanged class; adds the un-trust step |

## Seams
- The `orq` command (`orq new`, `orq resume`, `orq issues`, `orq clean`) run as a process, with `ORQ_HC` pointing at the fake `hc` (test/herdr.test.ts) and `CLAUDE_CONFIG_DIR` at a throwaway dir: catches the hc calls and labels, the messages and exit codes, the env hc gets, the trust file's contents.

## Behaviors
- **B1 (AC1)** The session opens in the space named by `herdr_session`.
  Given config `herdr_session = "meal-prep"`, live terminals in "home" and "meal-prep" with labels sp-home and sp-meal, orq running in the "home" terminal. When `orq new "x"`. Then `hc run` has `--label herdr.space=sp-meal`.
  Level: integration. Seam: orq command. Pattern: none.
- **B2 (AC1)** Without `herdr_session`, the space is the repo's directory name.
  Given a repo dir `proj`, no `herdr_session`, live terminals in "proj" (sp-proj) and "home" (sp-home), orq running in "home". When `orq new "x"`. Then `hc run` has `--label herdr.space=sp-proj`.
  Level: integration. Seam: orq command. Pattern: none.
- **B3 (AC2)** `orq new` with the space not open keeps the task and says what to do.
  Given repo `proj`, live terminals only in "home" (orq runs in one of them). When `orq new "x"`. Then the exit code is non-zero, the output names the space `proj`, says to open it in the Herdr app and run `orq resume T-0001`; no `hc run`; `orq show T-0001` shows the task and its worktree exists.
  Level: integration. Seam: orq command. Pattern: none.
- **B4 (AC2)** `orq resume` with the space not open says the same and starts nothing.
  Given a task created while the space was not open (B3). When `orq resume T-0001`. Then non-zero, the same message, no `hc run`.
  Level: integration. Seam: orq command. Pattern: none.
- **B5 (AC2)** `orq issues` with the space not open comments on the issue, reports, and goes on.
  Given two open issues of the user (the existing fake `gh` in test/issues.test.ts), no terminal in the project's space. When one look of `orq issues`. Then both issues get a task and a comment, the output names the missing space and `orq resume <id>` for each, no `hc run`.
  Level: integration. Seam: orq command. Pattern: none.
- **B6 (AC3)** hc failing while orq looks for the space stops orq with hc's message.
  Given the fake `hc ls` (one variant) / `hc get` (another variant) exiting 1 with `{"message":"core unavailable"}` on stderr, or `hc ls` printing `not json`. When `orq new "x"`. Then non-zero, the output contains hc's message (or says hc's output cannot be read), no `hc run`.
  Level: integration. Seam: orq command. Pattern: failure of another system.
- **B7 (AC3)** No hc: the hand command, as today (the existing test in test/orq.test.ts keeps passing).
  Level: integration. Seam: orq command. Pattern: none.
- **B8 (AC4)** orq passes its terminal's socket to hc.
  Given `HC_TERMINAL_SOCKET=/run/x.sock`, no `HC_SOCKET`. When `orq new "x"`. Then every hc call gets `HC_SOCKET=/run/x.sock` (the fake logs it). Given `HC_SOCKET=/run/y.sock` as well: hc gets `/run/y.sock`.
  Level: integration. Seam: orq command. Pattern: none.
- **B9 (AC5)** `orq resume` labels a running terminal that has no space label.
  Given a task, its terminal `orq-t-0001` live with no labels, a live terminal in the project's space (sp-proj). When `orq resume T-0001`. Then `hc label <its address> herdr.space=sp-proj`, no `hc run`; the output says the session is running and now in the space.
  Level: integration. Seam: orq command. Pattern: none.
- **B10 (AC5)** `orq resume` leaves a labelled running terminal alone (the existing test, with labels given).
  Level: integration. Seam: orq command. Pattern: none.
- **B11 (AC6)** `orq new` trusts the worktree and keeps the rest of Claude's config.
  Given `$CLAUDE_CONFIG_DIR/.claude.json` with `{"numStartups":3,"projects":{"/a":{"hasTrustDialogAccepted":true,"x":1}}}`. When `orq new "x"`. Then the file has `projects[<worktree>].hasTrustDialogAccepted === true` and `numStartups` and `projects["/a"]` unchanged. Given no file: it is created with that entry.
  Level: integration. Seam: orq command. Pattern: none.
- **B12 (AC6)** `orq resume` trusts the worktree too (an entry removed by hand comes back).
  Level: integration. Seam: orq command. Pattern: none.
- **B13 (AC6)** `orq clean` removes the worktree's entry and keeps the rest.
  Given a task made with `orq new`, then dropped. When `orq clean T-0001`. Then `projects[<worktree>]` is gone, every other key unchanged.
  Level: integration. Seam: orq command. Pattern: none.
- **B14 (AC7)** `orq --version` prints `orq v0.10.0`.
  Level: integration. Seam: orq command. Pattern: none.

## Design
- The project's space is one function of the repo root: `herdr_session`, else `basename(root)`. `herdr_session` keeps its name in config.toml (the brief: it only overrides). The domain word is **Herdr space**; code comments and docs say space.
- Finding the space has three outcomes, modelled as such: the space's `herdr.space` label; *space not open* (a typed error carrying the space name and the task id); an hc failure (`OrqError` with hc's message). Every current `return []` becomes one of these. No fallbacks (Q2).
- A space is open when a live terminal (`hc ls`) has `where` whose part before " / " equals the space name; its label is read with `hc get`. A terminal with `where` and no `herdr.space` is an hc failure ("terminal <addr> in space <name> has no herdr.space label"), not silence.
- `hc` not installed (exit 127 on `hc ls`) means "no hc": the hand command, as today. It is checked before the space is looked for, so test/orq.test.ts (`ORQ_HC=orq-test-no-hc`) keeps passing.
- The `hc()` wrapper sets `HC_SOCKET` from `HC_TERMINAL_SOCKET` when `HC_SOCKET` is unset, because Fence replaces `XDG_RUNTIME_DIR`, where hc looks for its socket by default, and hc reads `HC_SOCKET` (seen live: with it, `hc ls` works inside Fence; without it, it fails).
- `startTask` returns the session outcome instead of failing, so `orq new` prints the task line first, then the message on stderr, and exits non-zero; `orq issues` posts its comment and prints the message. The task row and worktree are never rolled back for a missing space.
- `orq resume` on a running terminal: `hc get` its labels; without the project's `herdr.space`, `hc label <addr> herdr.space=<id>`. A terminal labelled with another space is left as it is (moving is out of scope).
- Pre-trust lives in its own module: the config file is `$CLAUDE_CONFIG_DIR/.claude.json`, else `$HOME/.claude.json`. Read, set or delete only `projects[<worktree>]`'s entry (setting keeps the entry's other fields), write to a temp file in the same dir and rename, so a reader never sees a half-written file. A file that is not valid JSON is not touched: orq warns and goes on (the session then shows the dialog), because overwriting it would destroy the user's Claude config.
- Pre-trust runs in `openSession` before the space lookup, so it also happens for the hand command and when the space is not open (the later `orq resume` trusts again anyway). Un-trust runs in `orq clean` after the worktree is removed.
- test/orq.ts sets `CLAUDE_CONFIG_DIR` to a fresh temp dir unconditionally (not `??=`), so no test run ever writes the real Claude config of whoever runs the tests.

## Tasks
### Wave 1
- **W1.1** The project's space, the three outcomes, no fallbacks, the socket, the resume label, the messages and exit codes in `orq new` / `orq resume` / `orq issues`. Touches: packages/cli/src/herdr.ts, git.ts, task.ts, cli.ts, issues.ts; test/herdr.test.ts (fake hc: failing `ls`/`get`, logging `HC_SOCKET`, `label`), test/issues.test.ts. Serves: AC1-AC5. Tests: B1-B10.

### Wave 2
- **W2.1** Pre-trust: a module for Claude's config file; called from `openSession`, un-trust from `orq clean`; `CLAUDE_CONFIG_DIR` in test/orq.ts. Touches: a new packages/cli/src/trust module, herdr.ts, clean.ts; test/orq.ts, test/herdr.test.ts, test/clean.test.ts. Serves: AC6. Tests: B11-B13.

### Wave 3
- **W3.1** Version 0.10.0 (packages/cli/package.json and wherever the release reads it, plugin version if it moves with the CLI); DESIGN.md (Sessions: project space, space not open, pre-trust as built), README (herdr_session default). Touches: package.json files, version.ts if needed, DESIGN.md, README.md, plugin manifest if versioned together. Serves: AC7. Tests: B14.

## Verification plan
| Check | Claim | Surface | Kind | How (what a user does and sees) | Evidence |
|-------|-------|---------|------|---------------------------------|----------|
| V1 | AC1-AC6 | cli | integration (impl) | the behavior tests B1-B13 run in `bun test` | the quality gate's test run |
| V2 | AC7 | cli | integration (impl) | B14; read DESIGN.md Sessions and README | test run; the diff |
| V3 | AC1, AC5 | cli + Herdr app | manual | with a "orqestrai" space open in the Herdr app, `orq new "check"` from any terminal: a tab for the task appears in that space; `orq resume` on it changes nothing | the user, at the PR: the desktop app cannot be seen by an agent |
| V4 | AC2 | cli + Herdr app | manual | close every terminal of the project's space (or set `herdr_session` to an unopened name), `orq new "check"`: the message names the space, no tab appears; open the space, `orq resume <id>`: the tab appears | the user, at the PR: needs the app |
| V5 | AC4, AC6 | Fence | manual | with `ORQ_SANDBOX='fence --'`, `orq new "check"`: the session in the app goes straight to `/orq:task`, no "trust this folder" dialog | the user, at the PR: Fence cannot run inside the verifier's Fence (bwrap fails nested) |

## Risk
medium: orq writes `~/.claude.json`, a file Claude owns and running Claude sessions also rewrite; a lost update there could drop a trust entry or a Claude setting. Mitigated by touching one entry, an atomic rename, and never writing a file orq cannot parse. Blast radius: every task start (`orq new`, `orq resume`, `orq issues`) now fails loudly where it used to start silently; a mistake in the space lookup blocks starting sessions until fixed (the hand command is still printed only when hc is missing). Priority: today a task can be unreachable from the app, and every Fence session stops at the trust dialog.

## Assumptions
- Claude reads trust from `projects[<path>].hasTrustDialogAccepted` in `$CLAUDE_CONFIG_DIR/.claude.json` / `~/.claude.json`, keyed by the worktree path as orq stores it (no symlinks in `~/.orqestrai/worktrees`). V5 proves it.
- hc reads `HC_SOCKET`; it ignores `HC_TERMINAL_SOCKET` (both seen live in the research).
- The Herdr app opens a tab for a terminal labelled `herdr.space` with no `herdr.tab` (t16, t17 today). V3 proves it.
- A lost update against a Claude process writing `~/.claude.json` at the same instant is accepted as rare (see Risk).

## Impl notes
