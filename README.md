# orqestrai

An orchestrated software factory with human gates:
triage → plan → impl → verify → learn → ship. The design is in [DESIGN.md](DESIGN.md).

Status: slice 1 — `orq new`, and a task session that runs triage and plan.

## Install (Claude Code)

```bash
ln -s "$PWD/bin/orq" ~/.local/bin/orq          # needs git, sqlite3; zellij optional
claude plugin marketplace add "$PWD"
claude plugin install orqestrai@orqestrai
```

## Use

In a project's git repository:

```bash
orq new "what you want"     # id, branch, worktree, zellij tab running /orqestrai:task <id>
orq ls                      # all tasks
orq show T-0001             # one task and its last events
```

Inside zellij, `orq new` opens a new tab. Outside, it uses the zellij session
`$ORQ_ZELLIJ_SESSION` (default `orq`) if it exists, or prints the command to run.

State is in `~/.orqestrai/state.db`, worktrees in `~/.orqestrai/worktrees/<repo>/`
(`ORQ_HOME` changes both). Task files are in `.orqestrai/tasks/<id>/` in the worktree.

## Layout

```
bin/orq                  mechanics: ids, state, worktrees, tabs
skills/task              the orchestrator for one task
skills/triage, plan      steps
skills/git               branch, staging, commit and push rules
skills/principle-*       short principles that steps load
templates/               task files; `orq file <id> <NAME>` copies one into the task
agents/researcher        neutral, read-only code research (triage)
```

## Credits

Ideas from firstmate, super-board, humanlayer, pstack, shipwright and mattpocock/skills
(see DESIGN.md §9). The principle skills are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT © 2026 Lauren Tan).
