---
name: task
description: Run one orqestrai task through its workflow (triage, plan, impl, verify, learn, ship) and stop at the human gates. Use when the user runs /orq:task <id> or asks to continue an orqestrai task.
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
| triage | `orq:triage`    | `RESEARCH.md`, `BRIEF.md` | `BRIEF.md` has `status: approved`, or the task is `DROPPED` | plan, at once; nothing if dropped |
| plan   | `orq:plan`      | `SPEC.md`                 | `SPEC.md` has `status: approved`  | impl, at once            |
| impl   | `orq:impl`            | code, tests, one commit per task | every wave committed, tests green | verify, at once   |
| verify | `orq:verify`          | `VERIFY.md`, `evidence/`, e2e tests | `VERIFY.md` has `status: passed`  | learn, at once; back to impl when `failed`; wait for the user when `escalated` |
| learn  | `orq:learn`           | `LEARN.md`, applied proposals | `LEARN.md` has `status: applied` | ship, at once     |
| ship   | `orq:ship`            | `PR.md`, the PR, link `gh-pr` | the PR is open, task `WAITING FOR ME` | nothing: the user merges |

After ship, the task waits for the merge. `orq show` reads the PR from GitHub and sets
`MERGED` by itself. When the user asks for changes on the PR, `orq:ship` says what to do.

## Records

- When a step starts: `orq state <id> <step> "IN PROGRESS"`.
- When you wait for the user: `orq ask <id> "<your message>"`, then end your turn. It sets
  `WAITING FOR ME` (its first line is the note) and posts the message in the task's Slack
  thread, where the user may answer. Pass the whole message, as you would write it here:
  a first line that says what you need, then the questions and your recommendations.
- When the user answers: `orq state <id> <step> "IN PROGRESS"`.
- When a step cannot continue (a tool fails, an input is missing):
  `orq state <id> <step> BLOCKED "<reason>"`, tell the user, stop.
- At the end of each step, commit its files, following `orq:git`.

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
  for each. Triage and plan ask in rounds, as `orq:grill` says.
- Ask with `orq ask` (Records), and end your turn. The user's answer comes in this
  conversation, typed in by the Slack bridge or by them.
- Report outcomes and decisions. Do not report progress or internal mechanics.

## Never

- Work outside the task worktree, or on the base branch.
- Merge, force-push, or push to the base branch. Set `MERGED` yourself.
- Run `orq clean`. The user runs it.
- Read `.env*`, keys, or credential files.
- Skip a gate, or change an approved file without telling the user.
