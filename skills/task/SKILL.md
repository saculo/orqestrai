---
name: task
description: Run one orqestrai task through its workflow (triage, plan, impl, verify, learn, ship) and stop at the human gates. Use when the user runs /orqestrai:task <id> or asks to continue an orqestrai task.
argument-hint: <task-id>
---

# orqestrai: task

You orchestrate one task: `$ARGUMENTS`. You know the workflow. You find the current step,
start it, and stop at each gate. The step skills do the work. You keep the task moving and
the records true.

## Start (every time, also after a restart)

1. Run `orq show <id>`. It gives the step, the status and the worktree.
2. Check that `git rev-parse --show-toplevel` is that worktree. If it is not, stop and tell
   the user. Do not work in another checkout.
   Check that `echo $ORQ_TASK` prints this id. If it does not, the guard hooks are off:
   tell the user to start the session with `orq open <id>`.
3. Read the files in `.orqestrai/tasks/<id>/`. The `status:` line in each file's
   frontmatter and the database row together tell you where the task is.
4. Continue from the workflow below. A restart must lose nothing: decisions are in the
   files, not in this chat.

## Workflow

| Step   | Skill                 | Writes                    | Done when                         | Next                     |
|--------|-----------------------|---------------------------|-----------------------------------|--------------------------|
| triage | `orqestrai:triage`    | `RESEARCH.md`, `BRIEF.md` | `BRIEF.md` has `status: approved` | plan, at once            |
| plan   | `orqestrai:plan`      | `SPEC.md`                 | `SPEC.md` has `status: approved`  | impl, at once            |
| impl   | not built yet         |                           |                                   |                          |
| verify | not built yet         |                           |                                   |                          |
| learn  | not built yet         |                           |                                   |                          |
| ship   | not built yet         |                           |                                   |                          |

When the next step has no skill yet, run `orq state <id> <step> TODO "not built"`, tell
the user, and stop.

## Records

- When a step starts: `orq state <id> <step> "IN PROGRESS"`.
- When you wait for the user: `orq state <id> <step> "WAITING FOR ME" "<one line why>"`.
- When the user answers: `orq state <id> <step> "IN PROGRESS"`.
- When a step cannot continue (a tool fails, an input is missing):
  `orq state <id> <step> BLOCKED "<reason>"`, tell the user, stop.
- At the end of each step, commit its files, following `orqestrai:git`.

## Gates

A gate is passed only by the user's explicit word in this conversation ("approved",
"go", "yes, plan it"). When the user approves:

1. Set `status: approved` in the file's frontmatter.
2. Commit.
3. Start the next step at once.

You never set `status: approved` by your own decision.

## Talking to the user

- Ask only about decisions that are the user's: scope, product behavior, accepting a risk,
  the gates. Decide reversible things yourself, write the decision in the step's file, and
  continue.
- Ask in plain text, not with a question tool, so the same question works in a terminal
  and in a Slack thread. Number the questions. Give your recommended answer and the reason
  for each.
- After you ask, set `WAITING FOR ME` and end your turn.
- Report outcomes and decisions. Do not report progress or internal mechanics.

## Never

- Work outside the task worktree, or on the base branch.
- Merge, force-push, or push to the base branch.
- Read `.env*`, keys, or credential files.
- Skip a gate, or change an approved file without telling the user.
