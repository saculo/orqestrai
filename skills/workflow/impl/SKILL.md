---
name: orq-impl
description: orqestrai impl step. Runs the tasks of an approved SPEC.md wave by wave, one orq-implementer subagent per task, then commits each task. In round 2+ it fixes what verify found. Loaded by orq-task; do not run it alone.
---

# orqestrai: impl

Input: the approved `SPEC.md`; in round 2+ also `VERIFY.md`.
Output: code and tests in the worktree, one commit per task.

Load `orq-git`, `orq-principle-smallest-change`, `orq-principle-sequence-verifiable-units`,
`orq-principle-fix-root-causes`. In round 2+ also `orq-principle-attack-the-premise`.

## 1. Plan the waves

Read `SPEC.md`: **Tasks** (waves), **Acceptance criteria**, **Behaviors**, **Seams**,
**Design**. Run the waves in order. A wave starts only when the one before it is
committed.

Before a wave, check that no two of its tasks name the same file or module. If two do,
run those two one after the other.

## 2. Start one implementer per task

Start all tasks of the wave at once: one `orq-implementer` subagent per task, in one
message. Each prompt holds **only** what that task needs, copied from `SPEC.md`:

```
Task <W1.2>: <the task block: what, Touches, Serves, Tests>

Acceptance criteria it serves:
<AC lines>

Behaviors to test:
<B lines: given / when / then, level, seam, pattern>

Seams: <the seams these behaviors use>
Design that applies: <the Design lines that shape this task, or "none">

Worktree: <path>. Test command: <test command from .orqestrai/config.toml, or "none
configured: find the project's test command">.
```

Do not add the brief, the research, other tasks or this conversation. If the task needs
them, the spec is incomplete: that is a gap.

## 3. After the wave

Read each report.

- **Gap** — the implementer needs a decision the spec does not give:
  - reversible and inside the agreed scope (a name, an internal shape, the order of
    work): decide it, add a line to **Impl notes** at the end of `SPEC.md`
    (`<W1.2>: <decision>, because <reason>`), and start that task again with the answer;
  - it changes behavior, scope or a seam: ask the user (see `orq-task`: plain text,
    numbered, your recommendation). Work that does not depend on it continues.
- **Blocked:** record `orq state <id> impl BLOCKED "<reason>"`, tell the user, stop.
- **Outside the task:** a file touched outside the task is allowed only when the report
  says why and it is needed. Otherwise revert that file and start the task again.

Check it yourself; a report is a claim:

1. `git status --short`: the changed files match the reports.
2. Run the test command once for the whole worktree. A red test stops the wave: send
   the failing task back to its implementer with the output.
3. Commit **each task separately**, following `orq-git`: stage that task's files by
   name, `feat(<id>): <subject>` (or `fix`, `test`, `refactor`), `<W1.2>` in the body.

Then the next wave.

## 4. Round 2+ (back from verify)

Read the last round of `VERIFY.md`. The work is its failing items: a quality-gate
command that failed, each `NOT VERIFIED` check, each blocking finding.

- Find the cause before you fix (`orq-principle-fix-root-causes`). If the same cause
  came back from the round before, question the approach, not only the code
  (`orq-principle-attack-the-premise`).
- Group the items by the task they belong to. Start one implementer per group, with the
  task block as in step 2 plus the failing items and their evidence. Not the reviewer's
  other findings, not the verifier's reasoning.
- An item that shows the spec itself is wrong is not a fix: ask the user.
- Commit as in step 3: `fix(<id>): <subject>`, the round and the items in the body.

## 5. Done

All waves committed and the tests green: run `orq state <id> verify "IN PROGRESS"` and
continue with `orq-verify`.
