---
name: plan
description: orqestrai plan step. Turns an approved BRIEF.md into an approved SPEC.md - acceptance criteria, seams, tasks in waves, a verification plan and a risk rating. Loaded by orqestrai:task; do not run it alone.
---

# orqestrai: plan

Input: the approved `BRIEF.md`, `RESEARCH.md`, the code, `docs/adr/`, `GLOSSARY.md`.
Output: `.orqestrai/tasks/<id>/SPEC.md`.

Load these principle skills: `orqestrai:principle-model-the-domain`,
`orqestrai:principle-smallest-change`, `orqestrai:principle-sequence-verifiable-units`,
`orqestrai:principle-boundary-discipline`, `orqestrai:principle-test-behavior`.

## 1. Read

Read the inputs. Read more code where the plan needs it. For a large area, use
`orqestrai:researcher` with specific questions.

## 2. Draft SPEC.md

Run `orq file <id> SPEC` and fill every section.

- **Acceptance criteria:** take them from the brief, make each one observable, number
  them `AC1…`.
- **Seams:** the public interfaces where tests go: function signatures, endpoints, CLI
  commands, events. Impl writes its unit, integration and contract tests only there.
- **Design:** only the decisions that shape the tasks. Name the data structure that holds
  the domain. Link ADRs that apply. No essay.
- **Tasks:** small, each ends in a state that can be checked. A task names the files or
  modules it touches and the ACs it serves. Group tasks in waves. Two tasks in one wave
  must not touch the same files.
- **Verification plan:** chosen for this scenario, not from a fixed list. Every AC is
  covered by a test (written in impl) or a check (run in verify), or both.
  Check kinds: e2e journey (browser, CLI, API), visual comparison, security scan,
  contract, performance, manual (the user). Use manual only when no automated check can
  prove the claim. The verifier will not read the code, so describe each check by what a
  user does and sees.
- **Risk:** low, medium or high, with the reasons. High risk turns on the adversarial
  review in verify.

## 3. Ask the user

Same rules as triage: at most 5 numbered questions in one round, each with your
recommended answer. Ask about scope, behavior and risk, not about things you can decide.
Write each answer into `SPEC.md` at once.

## 4. Gate

Show the user a short summary: the ACs, the waves, the checks, the risk. Ask for
approval. That is the gate.
