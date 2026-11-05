---
name: orq-plan
description: orqestrai plan step. Turns an approved BRIEF.md into an approved SPEC.md - grills the design first, confirms the seams, then writes acceptance criteria, behaviors, waves, a verification plan and a risk rating as a synthesis. Loaded by orq-task; do not run it alone.
---

# orqestrai: plan

Input: the approved `BRIEF.md`, `RESEARCH.md`, the code, `docs/adr/`, `GLOSSARY.md`,
`.orqestrai/testing.md` (if it exists).
Output: `.orqestrai/tasks/<id>/SPEC.md`.

Load `orq-grill`, `orq-problem-class`, `orq-principle-model-the-domain`,
`orq-principle-smallest-change`, `orq-principle-sequence-verifiable-units`,
`orq-principle-boundary-discipline`, `orq-principle-test-behavior` (and its
`GUIDELINES.md`).

**Order matters.** Decisions come first, the written spec last. A spec drafted before the
questions turns the questions into a rubber stamp, and the draft steers the answers.

## 1. Read

Read the inputs. Read more code where the plan needs it. For a large area, use
`orq-researcher` with specific, neutral questions.

## 2. Grill the design

Run `orq file <id> SPEC`. Fill only **Open decisions** and **Decisions** for now. Grill
with `orq-grill`. The decisions to grill, roughly in tree order:

1. **Acceptance criteria.** Turn the brief's desired behavior into observable criteria.
   Each one checkable on its own.
2. **Operations and their class.** List the operations the change adds or changes.
   Classify each one with `orq-problem-class`. Most answers come from the code;
   ask the user only what the code and the brief cannot settle. A **resource contention**
   operation loads `orq-consistency-unit`.
3. **Behaviors.** Per AC, the behaviors in glossary words, what is observed, the level
   and any hard-to-test pattern (see `GUIDELINES.md`). Ask the user about effects only
   they know ("who notices when this works?").
4. **The data structure** that holds the domain (`orq-principle-model-the-domain`). Start
   from the question the feature must answer, not from the nouns.
5. **Scope edges** the brief left open, and **risk**.

Decide reversible things yourself (names, internal structure, order of work). Record
them under **Design** with the reason.

## 3. Confirm the seams

When the behaviors are settled, propose the seams in one question:

- the highest seam possible, where a test is still fast and deterministic;
- as few as possible (one is ideal);
- existing seams before new ones.

```
Q<n> - Seams: tests go at <seam A> (B1, B2, B3) and <seam B> (B4). <Why these.>
Recommended: yes.
```

## 4. Write the spec

Now fill the rest of `SPEC.md` as a **synthesis of the Decisions**. Make no new decision
here. Anything not decided goes under **Assumptions**.

- **Operations:** each one with its class and the answer that decided it.
- **Seams:** the public interfaces where tests go. Impl writes unit, integration and
  contract tests only there.
- **Behaviors:** given / when / then, given state built through the API, level, seam,
  pattern.
- **Design:** only the decisions that shape the tasks. Link ADRs that apply. No essay.
- **Tasks:** small, each ends in a state that can be checked. A task names the files or
  modules it touches, the ACs it serves and the behaviors it tests. Group tasks in waves.
  Two tasks in one wave must not touch the same files.
- **Verification plan:** every AC is covered by a behavior test (impl), a check (verify),
  or both. Check kinds: e2e journey (browser, CLI, API), visual comparison, security
  scan, contract, performance, manual (the user). Use manual only when no automated check
  can prove the claim. The verifier and the e2e writer will not read the code, so
  describe each check by what a user does and sees. **Committed?** for each e2e check:
  yes keeps it as a regression test in the project's e2e module (the default for main
  journeys); no means driving the app is enough.
  **Surface** for each automated check: the part of the app it drives (`api`, `web`,
  `cli`, …). Each surface needs a driver skill, `.claude/skills/verify-<surface>/`. When
  one is missing, add an open decision for the user: write that skill before impl, or
  make those checks manual.
- **Risk:** low, medium or high, with the reasons. High risk turns on the adversary in
  verify.

## 5. Gate

Show the user a short summary: the ACs, the operations and their classes, the waves, the
checks, the risk, the assumptions. Ask for approval. That is the gate.
