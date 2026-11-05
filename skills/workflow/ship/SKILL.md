---
name: orq-ship
description: orqestrai ship step. Rebases the task branch onto the base branch, runs the quality gate again, pushes the task branch, opens the PR with a body made from the task files, links it to the task and waits for the user to merge. Loaded by orq-task; do not run it alone.
---

# orqestrai: ship

Input: the task files, with `VERIFY.md` `passed` and `LEARN.md` `applied`.
Output: a pull request, linked to the task as `gh-pr`. `.orqestrai/tasks/<id>/PR.md`
holds its body.

Load `orq-git`, `orq-principle-prove-it-works`.

## 1. Rebase

1. `git remote` must name a remote. If none: `orq state <id> ship BLOCKED "no git
   remote"`, tell the user, stop.
2. `git fetch origin <base>`, then `git rebase origin/<base>`.
3. On a conflict, follow `orq-git`. If the resolution changes behavior, stop:
   `orq state <id> ship "WAITING FOR ME" "rebase conflict in <files>"`.

## 2. Quality gate, again

Run `[commands]` from `.orqestrai/config.toml`, as `orq-verify` step 1 says. The base
branch may have changed under the task.

If a command fails: do not open the PR. Run `orq state <id> ship "WAITING FOR ME"
"<command> fails after rebase"`, show the last lines of its output, and recommend one
way forward: another impl round, or a fix you name. Stop.

## 3. Write the PR body

Run `orq file <id> PR` and fill it from the task files. Copy, do not invent:

- **What and why:** from `BRIEF.md`.
- **Acceptance criteria:** each AC from `SPEC.md`, with the verdict and one line of
  evidence from the last round of `VERIFY.md`.
- **For you to check:** each check from the verification plan with Kind = manual,
  with its steps. These are for the user. Nobody ran them.
- **Verify:** the number of rounds, the last quality gate, what the review found and
  impl fixed.
- **Open findings:** "For the PR body" in `VERIFY.md`.
- **Learn:** the proposals in `LEARN.md`.
- **Decisions** and **Risk:** from `SPEC.md`. Only what a reviewer needs.

Keep it short. A reviewer reads it in two minutes. Commit it: `docs(<id>): ship`.

## 4. Push and open the PR

1. `git push -u origin HEAD`. If the branch was pushed before and you rebased, use
   `--force-with-lease`. Never push to the base branch.
2. Title: `<type>(<id>): <subject>`, as `orq-git` says for commits. The type of the
   main change.
3. `gh pr create --base <base> --title "<title>" --body-file .orqestrai/tasks/<id>/PR.md`.
4. `orq link <id> gh-pr <url>`.
5. `orq state <id> ship "WAITING FOR ME" "PR <url>: review and merge"`.

Tell the user, in a few lines: the PR URL, the manual checks waiting for them, the number
of open findings. Stop.

## After the PR is open

- **Merge** is the user's. `orq ls` and `orq show` read the PR from GitHub and set the
  task to `MERGED`. Do not set `MERGED` yourself. After the merge, the user runs
  `orq clean <id>`.
- **The user asks for changes** (in this session or as PR comments they point you to):
  treat them like verify findings. Run impl for them, then verify. Run learn only if the
  change taught something new. Then ship again: rebase, gate, push, and update the body
  with `gh pr edit <url> --body-file .orqestrai/tasks/<id>/PR.md`.

## Never

- Merge the PR, approve it, or push to the base branch.
- Open the PR when the quality gate fails.
- Put in the PR body a verdict that is not in `VERIFY.md`.
