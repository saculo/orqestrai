---
name: orq-git
description: orqestrai git rules - branches, worktrees, staging, commit messages, pushing. Load before any git write (commit, branch, rebase, push) in an orqestrai task.
---

# orqestrai: git

## Branches and worktrees

- `orq new` creates the branch `orq/<id>-<slug>` and its worktree. Do not create
  branches or worktrees yourself.
- Work only in the task's worktree. Never commit on the base branch.

## Staging

- Stage named paths: `git add <path>…`. Do not use `git add -A` or `git add .`.
- Before each commit, read `git status --short` and `git diff --cached --stat`.
  Commit only what the step changed.
- Never stage `.env*`, keys, credentials, build output or local config.

## Commits

One commit per verifiable unit: a task from `SPEC.md`, or a step's files.

```
<type>(<id>): <subject>

<body: why, not what. Optional for small commits.>
```

- `type`: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Step files use `docs`, for example `docs(T-0007): approve brief`.
- Code: `feat(T-0007): retry failed webhook calls`. Put the wave task (`W1.2`) in the
  body, not in the subject.
- Subject: short, imperative, lower case, no full stop, at most 72 characters.
- Write in simple, direct English: short sentences, one idea per sentence, active voice,
  the same word for the same thing (the glossary words).
- No AI co-author lines.

## History

- Rebase the task branch onto the base branch before ship: `git rebase <base>`.
- On conflict: resolve it, run the tests of the touched code, continue. If the
  resolution changes behavior, stop and tell the user.
- Force-push only the task branch, and only with `--force-with-lease`.

## Never

- Push to the base branch. Merge into the base branch. That is the user's gate.
- `git reset --hard`, `git clean -f`, `git checkout -- <path>` on changes you did not make.
- Rewrite commits that are already on the base branch.
- `--no-verify` to skip hooks.
