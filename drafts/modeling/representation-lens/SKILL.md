---
name: orq-representation-lens
description: DRAFT, not in the flow. orqestrai modeling tool. For a question the system must answer, finds the operation it needs and the representation (graph, state machine, event stream, …) that makes that operation native. Works for business and technical code. Proposes the smallest experiment, never a redesign.
---

# orqestrai: representation lens (draft)

Possible signal: the domain answers a question badly — the code needs many joins, loops
or flags to answer it, or cannot answer it at all.

## Questions before models

Never start from "this should be a graph". Start from the question:

1. **What question must the system answer?** One sentence, in glossary words.
2. **What operation does it need?** Reachability, a legal next step, an ordered history,
   overlap in time, "is there any valid solution", "which solution is best", nearest
   neighbour, membership, a running balance, waiting time.
3. **Which representation makes that operation native** — one call or one standard
   algorithm instead of custom code?

The same concept can need several representations for several questions. There is no one
canonical model for a noun.

**Choose independently of the current code.** What exists today is not a reason to pick a
lens. It is good news afterwards: "part of this projection already exists, so the
experiment is cheap."

## Question shape → representation

| Question shape | Operation | Representation | Business | Technical |
|---|---|---|---|---|
| what depends on X? what breaks if X fails? | reachability, cycles, blast radius | graph | which orders a late supplier affects | which modules a change touches; which tasks can share a wave |
| what can happen next? | outgoing transitions | state machine | can this order still be cancelled? | can this task go to verify? protocol states |
| how did we get here? | ordered replay | event stream | why does this account show this balance? | why is this task blocked? (`events`) |
| valid at time T? overlaps? | intervals | temporal model | is this contract active on that date? | is this lease still held? |
| does any valid solution exist? | constraint satisfaction | constraint model | can this timetable work? | can these tasks fit in 3 waves? |
| which valid solution is best? | optimization | optimization model | cheapest delivery route | best packing of jobs onto workers |
| which past case is most similar? | nearest neighbours | vector / similarity | similar claims | similar past failures (root-cause hash) |
| parent, child, subtree? | traversal | tree | org structure | file tree, AST |
| in both? in one, not the other? | set operations | sets | customers in both campaigns | files changed in both tasks |
| who covers what? | coverage | matrix / bipartite | driver ↔ ride | AC ↔ test, rule ↔ file |
| where does work wait? | waiting time, bottleneck | queue / flow | where do orders stall? | verify slots, CI queue |
| how much is owed / used? | accumulation | ledger | balance of an account | quota used, budget left |
| identity and current state | lookup, update | entity | the customer now | the task row now |
| a rule that must hold under concurrency | atomic check | consistency unit | last seat | task id (see `orq-consistency-unit`) |

Guardrail: a lens fits when the question becomes **one native operation** of it, not when
the data "looks like" it. Many things look like graphs.

## Why this one

Every proposed lens comes with one short paragraph: the operation the question needs,
the native operation of the lens that answers it, and why the other plausible lenses fit
worse. Compare them internally; report only the winner and the reason.

## Smallest experiment

A new lens does not mean a production redesign. Prefer the smallest form that tests its
usefulness:

script → notebook → generated diagram → offline index → shadow read model →
production read model → architecture change.

Never jump from "this question is graph-shaped" to "move the system to a graph database".

## Output

A **map of models**, grouped by representation, not a list per question. One
representation usually serves a family of questions:

```
## <Representation> perspective
Elements: <nodes / states / events / …, in glossary words>
Native operations: <…>
Questions it simplifies: <existing questions>
Questions it opens: <new questions that become cheap; for each, which decision it would change>
Smallest experiment: <…>
```

In a task: the chosen lens and its reason go to **Design** in `SPEC.md`. New questions it
opens are proposals for learn, not scope for this task.
