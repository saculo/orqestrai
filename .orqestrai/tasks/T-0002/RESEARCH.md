---
id: T-0002
---

# Research: task sessions in Herdr spaces, and folder trust under Fence

Questions were asked without the request, so the findings describe the code as it is.

## Every failure to find a space label is silent; the session starts unlabelled

**Question:** How does `openSession` decide which `--label` args to pass to `hc run`?

`spaceLabel(session)` returns `["--label","herdr.space=<id>"]` or `[]`. It picks a terminal
to copy the label from: the first live terminal whose `where` session name equals the
configured `herdr_session`, else `HC_TERMINAL_ID` (the terminal orq runs in), else any
terminal that has a `where`. Then it reads that terminal's labels with `hc get`. Each
failure returns `[]` with no message: `hc ls` fails or prints bad JSON, no candidate
terminal, `hc get` fails or prints bad JSON, the terminal has no `herdr.space`. A configured
`herdr_session` that matches no open terminal falls back silently to the caller's own
session (`HC_TERMINAL_ID`) or to any session.

**Evidence:**
- `packages/cli/src/herdr.ts:68-74`: `liveTerminals` returns `[]` on a non-zero exit or a decode error.
- `packages/cli/src/herdr.ts:87-98`: `spaceLabel`, each `return []`.
- `packages/cli/src/herdr.ts:102-124`: `openSession` splices the result into `hc run` unconditionally.

**Tests:** `test/herdr.test.ts` (fake `hc` bash script via `ORQ_HC`): the label from
`HC_TERMINAL_ID`, from the first terminal with `where`, from the configured `herdr_session`.
None of the failure branches is tested.

## The project's Herdr session is `herdr_session` in config.toml, with no default

**Question:** Where does `session` come from, and what is its default?

`herdrSession(root)` reads `herdr_session` from `<repo>/.orqestrai/config.toml`; unset is
`undefined`. Callers: `startTask` (`orq new`, `orq issues`) and `orq resume`. `orq issues`
discards the session message.

**Evidence:**
- `packages/cli/src/git.ts:13-32`: `ProjectConfig.herdr_session` optional; `herdrSession`.
- `packages/cli/src/task.ts:50`, `packages/cli/src/cli.ts:79`: the callers.
- `packages/cli/src/issues.ts:80`: `const { task } = …`, the session string dropped.
- `README.md:25`: `herdr_session = "meal-prep"` documented as optional.

**Tests:** `test/herdr.test.ts:80-96` (configured `herdr_session`).

## hc shows a terminal's session name in `where`; it cannot list sessions

**Question:** What do `hc ls --json` / `hc get --json` output, and can hc list sessions?

`where` is `"<session name> / <tab>"`, e.g. `"meal-prep / 1"`. App-created terminals carry
`herdr.seen`, `herdr.space`, `herdr.tab` and `where`. Terminals orq started with the label
carry `herdr.space` (same id as the app terminals in that session) and `where`, no
`herdr.tab`. hc has no command that lists sessions or spaces; only the app creates them. A
session is visible to orq only through a live terminal in it.

**Evidence:** live `hc ls --json`, `hc get t13|t15|t16|t17 --json`; `hc --help`, `hc ls --help`
(`--all`, `--json`, `--label`), `hc run --help`.

## Root cause for T-0001: the installed orq predates the label code

**Question:** Why did meal-prep T-0001's terminal have `labels {}`?

T-0001's terminal `t14` (`orq-t-0001`, `labels {}`, `where` null) was created 2026-11-23
22:19:51, 8 s after the user's app terminal `t13` in `meal-prep` (tab "T-0001"). The `orq`
on PATH (`~/.local/bin/orq` → `~/.bun/bin/orq` → the global `orqestrai/dist/orq.js`) was
built 2026-11-23 13:11 from #34. The label code came in #35 (2026-11-23 22:00). The
installed build contains no `herdr.space` and no `--label` at all. #35 did not bump the
version: both builds report `orq v0.9.0`, so nothing showed the install was stale.
T-0001's later terminal `t16` (22:22:29) does carry the label; it was started by a newer
orq (the checkout's `bin/orq` was updated 22:19:08).

**Evidence:**
- `hc get t14 --json`: `created_ms 1795468791921`, `labels {}`, argv `fence -- env ORQ_TASK=T-0001 …`.
- `ls -l ~/.bun/install/global/node_modules/orqestrai/dist/orq.js`: 2026-11-23 13:11:57.
- `grep -o 'herdr[._a-z]*' dist/orq.js`: only `herdr` twice; no `herdr.space`, no `"--label"`.
- `git log`: 71eaebf (#35) 2026-11-23 22:00; `packages/cli/package.json` version 0.9.0.

**Tests:** none for a stale install.

## A second way to lose the label: orq inside Fence cannot reach hc's socket

**Question:** Do `hc ls` / `hc get` work from inside a herdr terminal?

Inside this task session (Fence), `XDG_RUNTIME_DIR` is Fence's own runtime dir, so bare
`hc` looks for its socket in the wrong place and fails ("unavailable"); `HC_SOCKET=/run/user/1000/herdr-core/default.sock`
works. `HC_TERMINAL_SOCKET` holds the real path, but orq does not pass it on. An orq
command run inside a task session (e.g. `orq resume` from a skill) would get `[]` from
`spaceLabel` silently. `hc()` unsets only `HC_TERMINAL_ID` for the child.

**Evidence:** `env` in the session (`XDG_RUNTIME_DIR=/tmp/fence-runtime-1000-…`,
`HC_TERMINAL_SOCKET=/run/user/1000/herdr-core/default.sock`); `packages/cli/src/herdr.ts:47-51`.

**Tests:** none.

## Pre-trust of worktrees is not implemented

**Question:** Where does orq pre-trust a worktree?

DESIGN.md says "orq pre-trusts each worktree, so the folder trust dialog never blocks", but
no code does it: nothing writes `~/.claude.json` or any trust setting, and the string
`hasTrustDialogAccepted` never appeared in git history. `~/.claude.json` has
`projects["/home/orq/Projects/orqestrai"].hasTrustDialogAccepted = true` and no entry for
any path under `~/.orqestrai/worktrees`.

**Evidence:**
- `DESIGN.md:502`.
- `git grep -i -E "trust|claude\.json" -- packages test`: no hits.
- `packages/cli/src/herdr.ts:12-35`: the session command; no config written.

**Tests:** none.

## Fence keeps HOME and `~/.claude*` as they are, writable

**Question:** What does Fence expose to the sandboxed process?

`ORQ_SANDBOX='fence --'` prefixes the session argv. The user config
`~/.config/fence/fence.jsonc` (extends the `code` template) allows writes to `~/.claude*`
and `~/.claude/**` and denies neither for reading; HOME is not remapped and
`CLAUDE_CONFIG_DIR` is unset. Inferred from config: `fence` could not be run from the
research sandbox (`bwrap: Failed to make / slave`).

**Evidence:** `packages/core/src/config.ts:15-16`, `packages/cli/src/herdr.ts:20-35`;
`fence config show`.

**Tests:** none.

## Open

- Whether Claude inside Fence reads the same `~/.claude.json` at runtime as outside (the
  config says yes; not observed). The trust dialog under Fence may simply be because no
  worktree was ever trusted, inside Fence or out.
- Whether the Herdr app opens a tab for a terminal that has `herdr.space` but no `herdr.tab`
  (t16, t17 suggest yes).
