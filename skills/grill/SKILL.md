---
name: grill
description: orqestrai grilling. How triage and plan ask the user questions - a design tree asked one frontier at a time, facts found by the agent, every answer written down at once. Loaded by orqestrai:triage and orqestrai:plan; do not run it alone.
---

# orqestrai: grill

You and the user reach a shared understanding of one task. Questions follow the
**design tree**. A step that loads this skill gives you two things: the file where answers
go and the kind of decisions to grill.

## The design tree

Decisions depend on each other. Write the open decisions down, each with the decisions it
depends on. Keep this list in the step's file, so a restart can rebuild it.

The **frontier** is every open decision whose prerequisites are settled: the questions you
can ask now without guessing at an answer you have not heard. Example, "retries for the
webhook sender":

- D1 Which failures are retryable? (depends on nothing)
- D2 Retry inline or in the background? (nothing)
- D3 Does the background queue survive a restart? (D2 = background)
- D4 Backoff and max attempts? (D2)
- D5 What does the caller see after the last failure? (nothing)

Round 1 asks D1, D2, D5. If the answer to D2 is "inline", D3 is gone and D4 changes.
Round 2 asks the new frontier.

## A round

1. **Find the facts first.** A question about what the code does, what exists, or how
   something works today is a fact, not a decision. Get it yourself. For more than a quick
   look, start `orqestrai:researcher` with neutral questions. Never ask the user a fact.
   Only the decisions that depend on a running search wait for it.
2. **Ask the whole frontier** in one message, in plain text:

   ```
   Q<n> - <title>: <the question, with the options and what each one means>
   Recommended: <your answer> - <why>
   ```

   Number the questions across rounds (Q1, Q2, … never restart at Q1). Word each question
   so that "yes" accepts your recommendation. A question whose answer depends on another
   question in the same round waits for the next round.
3. Set `WAITING FOR ME` (see `orqestrai:task`) and end your turn.
4. **When the user answers**, write each answer into the step's file at once, one line:
   `Q<n> <decision>: <answer>`. Then recompute the tree: an answer can settle, add or
   remove decisions.

An answer that is unclear, or that contradicts an earlier answer, is a new question for
the next round. Say which answers conflict.

## Domain words while you grill

Load `orqestrai:principle-model-the-domain`. While you grill:

- **Check terms against `GLOSSARY.md`.** "The glossary says Cancellation is X; you seem
  to mean Y. Which one?"
- **Sharpen vague words.** "Account: the Customer or the User?"
- **Make it concrete.** Invent a short edge-case scenario that forces a precise answer.
- **Check claims against the code.** "You say partial cancel exists; the code cancels
  whole orders. Which is right?"

When a term is settled, add or update it in `GLOSSARY.md` at once:

```
## <Term>
<What it is, in one or two sentences. No implementation details.>
_Avoid_: <other words for the same thing>
```

Only terms of this domain go there, not general programming words.

A term that means two things, or a concept nobody can place, is a signal for
`orqestrai:context-distilling`. Load it only then. Keep it calm: one signal, a few
questions, then back to the tree.

## ADRs

Offer an ADR (`docs/adr/NNNN-<slug>.md`, a few sentences: context, decision, why) only
when all three are true: the decision is hard to reverse, a reader would be surprised
without the context, and there was a real trade-off. Otherwise the decision stays in the
step's file.

## Done

The frontier is empty: every branch visited, nothing silently assumed. Anything you still
assume is written as an assumption in the step's file, so the user sees it at the gate.
