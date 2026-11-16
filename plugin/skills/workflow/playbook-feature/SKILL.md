---
name: playbook-feature
description: orqestrai playbook for a change to what the product does - new behavior, or a change to existing behavior - that needs a brief, a spec, code, tests and a PR. Also the playbook when no other one fits. Loaded by orq:task; do not run it alone.
---

# Playbook: feature

The steps, in this order. `orq:task` runs them and keeps the records; this file says only
which steps, what each one writes, and when it is done.

| Step   | Skill        | Writes                    | Done when                         | Next                     |
|--------|--------------|---------------------------|-----------------------------------|--------------------------|
| triage | `orq:triage` | `RESEARCH.md`, `BRIEF.md` | `BRIEF.md` has `status: approved`, or the task is `DROPPED` | plan, at once; nothing if dropped |
| plan   | `orq:plan`   | `SPEC.md`                 | `SPEC.md` has `status: approved`  | impl, at once            |
| impl   | `orq:impl`   | code, tests, one commit per task | every wave committed, tests green | verify, at once   |
| verify | `orq:verify` | `VERIFY.md`, `evidence/`, e2e tests | `VERIFY.md` has `status: passed`  | learn, at once; back to impl when `failed`; wait for the user when `escalated` |
| learn  | `orq:learn`  | `LEARN.md`, applied proposals | `LEARN.md` has `status: applied` | ship, at once     |
| ship   | `orq:ship`   | `PR.md`, the PR, link `gh-pr` | the PR is open, task `WAITING FOR ME` | nothing: the user merges |

Gates: `BRIEF.md` and `SPEC.md` (the user approves each).

Ends with: an open PR, `VERIFY.md` passed, the PR linked to the task (`gh-pr`).
