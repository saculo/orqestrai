---
name: learn
description: orqestrai learn step. After verify passes, an orq:learner subagent reads the task files and the diff, applies at most 5 lasting changes (ADRs, glossary, out-of-scope, agent rules, test rules, verify skills) in the task branch, and writes LEARN.md. Loaded by orq:task; do not run it alone.
---

# orqestrai: learn

Input: the task files (`BRIEF.md`, `RESEARCH.md`, `SPEC.md`, `VERIFY.md` with
`status: passed`) and the task branch.
Output: `.orqestrai/tasks/<id>/LEARN.md`, and the applied changes in the task branch.

The proposals are part of the PR. The user accepts them by merging it, or asks at the PR
to drop one. There is no gate here.

## 1. Run the learner

Start one `orq:learner` subagent. Give it only:

```
Task: <id>
Task folder: .orqestrai/tasks/<id>/
Diff: <base>..HEAD (worktree <path>)
```

## 2. Check its work

A report is a claim. Read `LEARN.md` and `git diff` of the files it changed.

- Drop a proposal that has no evidence in this task, repeats what the project already
  says, or is generic. Revert its change and move it to "Considered, not proposed".
- Drop a change to a verify skill that adds a task's checks instead of how to drive the
  app.
- More than 5 proposals: keep the 5 with the strongest evidence.
- Code, tests or another task file changed: revert those changes. Learn does not touch them.

Set `status: applied` in `LEARN.md`.

## 3. Commit

Follow `orq:git`. One commit with `LEARN.md` and the changed files:
`docs(<id>): learn`. Name the proposals in the body, one line each.

Continue with ship, as `orq:task` says. Do not ask the user. They see the proposals in
the PR.

## Never

- Apply a proposal the user rejected earlier in this task.
- Write an ADR for a decision that is easy to reverse.
