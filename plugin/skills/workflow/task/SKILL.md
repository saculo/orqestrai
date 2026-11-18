---
name: task
description: Run one orqestrai task - choose its playbook, run the playbook's steps, keep the records and stop at the human gates. Use when the user runs /orq:task <id> or asks to continue an orqestrai task.
argument-hint: <task-id>
---

# orqestrai: task

You orchestrate one task: `$ARGUMENTS`. A playbook says which steps the task runs; this
skill is what every playbook shares: where the task is, the records, the gates, talking to
the user. The step skills do the work. You keep the task moving and the records true.

## Start (every time, also after a restart)

1. Run `orq show <id>`. It gives the step, the status, the playbook (`type`) and the worktree.
2. Check that `git rev-parse --show-toplevel` is that worktree. If it is not, stop and tell
   the user. Do not work in another checkout.
   Check that `echo $ORQ_TASK` prints this id. If it does not, the guard hooks are off:
   tell the user to start the session with `orq open <id>`.
3. Read the files in `.orqestrai/tasks/<id>/`. The `status:` line in each file's
   frontmatter and the database row together tell you where the task is.
4. The playbook: if `orq show` names one in `type`, load its skill (`playbook-<name>`, in this
   plugin) and do not choose again. If it says `type = null`, choose one (below).
5. Continue from the playbook's steps. A restart must lose nothing: decisions are in the
   files, not in this chat.

## Choose the playbook

The playbooks are this plugin's skills named `playbook-*`. Each description says when it fits.

1. Read `REQUEST.md`. Compare it with each playbook's description.
2. One fits clearly: run `orq playbook <id> <name>` (the name without `playbook-`), load it,
   and start its first step.
3. None fits, or two do: ask (Messages) one question: which playbook, with the options
   and the one you recommend and why. End your turn. Record the user's choice as above.

You choose once. When a later step shows the task is of another kind (a bug fix that turns
out to be a new feature), stop: `orq ask <id>` with what you found and the playbook you
recommend. When the user agrees, record it with `orq playbook`, and continue the new
playbook at the step that matches the files the task has.

## Records

- When a step starts: `orq state <id> <step> "IN PROGRESS"`.
- When you wait for the user: `orq ask <id> "<the message>"`, then end your turn. It sets
  `WAITING FOR ME` (the headline is the note) and posts the message in the task's Slack
  thread, where the user may answer. Pass the whole message (Messages), exactly as you
  show it here.
- When a step cannot continue (a tool fails, an input is missing):
  `orq ask --blocked <id> "<the message>"`: the same, with status `BLOCKED`. Stop.
- When the user answers: `orq state <id> <step> "IN PROGRESS"`.
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
- Ask in plain text, not with a question tool, so the same message works in a terminal
  and in a Slack thread. Triage and plan ask in rounds, as `orq:grill` says.
- Ask with `orq ask` (Records), and end your turn. The user's answer comes in this
  conversation, typed in by the Slack bridge or by them.
- Report outcomes and decisions. Do not report progress or internal mechanics.

## Messages

Every message you send with `orq ask`, in every step, has one shape, in Markdown (the
terminal and Slack both render it):

```
**<headline: what happened, or what you need>**
- <the facts behind it, a short list from the step's file>

**Q<n> - <title>:** <the question, with the options and what each one means>
- Recommended: <your answer> - <why>
```

- The headline is one line; it is the task's status note. The list is optional.
- A question only when the user decides something; a report (the PR is open) has none.
- Number the questions across the whole task: continue from the highest `Q<n>` in the
  task's files. Word each one so that "yes" accepts your recommendation.
- A blank line between questions. Keep the message under 40 lines: the details are in
  the step's file, so name it.
- A gate is a question: the headline names the file, the list is its summary, and
  `**Q<n> - Approve <file>?**` / `- Recommended: yes`.

Each step skill shows its own example.

After the playbook's last step, the task waits for the merge. `orq show` reads the PR from
GitHub and sets `MERGED` by itself. When the user asks for changes on the PR, `orq:ship`
says what to do.

## Never

- Work outside the task worktree, or on the base branch.
- Merge, force-push, or push to the base branch. Set `MERGED` yourself.
- Run `orq clean`. The user runs it.
- Read `.env*`, keys, or credential files.
- Skip a gate, or change an approved file without telling the user.
