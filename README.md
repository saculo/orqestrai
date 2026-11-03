# orqestrai

An orchestrated software factory with human gates:
triage → plan → impl → verify → learn → ship. The design is in [DESIGN.md](DESIGN.md).

Status: slice 1 — `orq new`, and a task session that runs triage and plan.

## Install (Claude Code)

```bash
bun install                                    # needs Bun and git; zellij optional
ln -s "$PWD/bin/orq" ~/.local/bin/orq          # orq must be on PATH: the guard hook calls it
```

Then, in each project's git repository:

```bash
orq init      # .orqestrai/config.toml; skills, agents and the guard hook in .claude/
```

`orq init` writes the skills flat into `.claude/skills/orq-*/`. Run it again after you
change orqestrai: it replaces its own `orq-*` files and leaves the rest of `.claude/`
alone.

## Use

In a project's git repository:

```bash
orq new "what you want"     # id, branch, worktree, zellij tab running /orq-task <id>
orq ls                      # all tasks
orq show T-0001             # one task, its links and its last events
orq open T-0001             # open the task's tab again, for example after a restart
```

Always start a task session with `orq new` or `orq open`. They set `ORQ_TASK`, and the
guard hooks are active only when it is set.

Inside zellij, `orq new` opens a new tab. Outside, it uses the zellij session
`$ORQ_ZELLIJ_SESSION` (default `orq`) if it exists, or prints the command to run.

State is in `~/.orqestrai/state.db`, worktrees in `~/.orqestrai/worktrees/<repo>/`
(`ORQ_HOME` changes both). Task files are in `.orqestrai/tasks/<id>/` in the worktree.

## Layout

```
bin/orq                  launcher for src/cli.ts
src/                     orq: TypeScript, Effect 4, Bun. Mechanics only.
test/                    CLI and guard tests (bun run test)
skills/workflow/         task (the orchestrator), triage, plan (steps), grill (how they
                         ask questions), git (branch, staging, commit and push rules)
skills/modeling/         problem-class, consistency-unit, context-distilling: tools that
                         plan and grill load on signals
skills/principles/       short principles that steps load; test-behavior has GUIDELINES.md
templates/               task files; `orq file <id> <NAME>` copies one into the task
agents/researcher        neutral, read-only code research (triage)
src/guard/               `orq guard`: guards G1–G4 for task sessions (PreToolUse hook)
```

## Secrets on a VPS (second lock)

The guard hook blocks secret files only in task sessions. On the VPS, also add deny rules
to `~/.claude/settings.json`. Claude Code enforces them itself, in every session:

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)",
      "Read(~/.ssh/**)", "Read(**/credentials*)"
    ]
  }
}
```

## Credits

Ideas from firstmate, super-board, humanlayer, pstack, shipwright and mattpocock/skills
(see DESIGN.md §10). The principle skills are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT © 2026 Lauren Tan).
