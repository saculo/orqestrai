---
name: orq-archetypes
description: DRAFT, not in the flow. orqestrai modeling tool. Checks, one card at a time, whether a known model shape (an archetype) is at work in a problem - with business and technical vocabulary for each. Default verdict is "does not fit"; no match is a correct result. Names the shape and what it gives; does not design the architecture.
---

# orqestrai: archetypes (draft)

Possible signal: "have we seen this problem shape before?" — a new area, a model that
keeps growing special cases, or a design that feels invented from zero.

An archetype is a proven model shape that comes back across industries under different
words. Recognizing one gives you its known structure, its known traps and its known
questions for free.

## How to check

- **One card at a time**, in order. Read only that card while you judge it.
- **Default verdict: does not fit.** A card fits only when its deciding question gets a
  clear yes from the problem itself. Keywords are not evidence: "price" in the request
  does not make it Pricing.
- Judge from the problem's language and the brief, not from the code's current shape.
- A card can be **unclear**: then it gives one question for the user, with the answer
  that would make it fit. Ask all unclear questions together, after all cards.
- **No match is a correct result.** Most problems match zero or one archetype.
- Fits do not have to connect. Do not design how they integrate; that is plan's work.

## The cards

**Product — definition vs instance**
Signals: a catalog; variants; bundles; "the same thing" sold or used many times with
its own state. Technical: template vs instance, image vs container, schema vs record.
Anti-signal: one-off things with no shared definition.
Deciding question: is there a definition that many instances are created from, and do
instances change without changing the definition?

**Pricing — a value as a function of context**
Signals: a value built from components and conditions (who, when, how much, where).
Technical: cost or quota computed from many factors, a scoring formula.
Anti-signal: a fixed number stored on a record.
Deciding question: does the value depend on the context of the request, through
components that can be added or changed?

**Rules & scoring — rules as data**
Signals: rules that change often, combine, or are set by non-developers; a score from
several criteria. Technical: a policy engine, lint rules, feature flags, alert rules.
Anti-signal: two stable `if`s.
Deciding question: must rules be added, combined or changed without changing the code
that applies them?

**Accounting — entries, not balances**
Signals: value that moves between holders; history that must be exact; corrections as
new entries. Technical: an append-only log, quotas and usage, state as a projection of
entries.
Anti-signal: a number simply overwritten.
Deciding question: must every change be explainable as an entry, with the balance
derived, never edited?

**Party — identity vs role**
Signals: one person or organization acting in several roles (customer, supplier,
employee); relations between parties. Technical: a principal with roles and grants.
Anti-signal: one kind of actor with one role.
Deciding question: can one identity hold several roles, and must they stay one
identity?

**Availability — a limited resource**
Signals: reservations, capacity, holds, waiting lists, double booking. Technical: a
resource pool, worker or verify slots, leases, rate limits.
Anti-signal: unlimited supply.
Deciding question: is something limited that several requests compete for over time?
(Fits often go with `orq-consistency-unit`.)

**Ordering — a request for fulfilment**
Signals: an order that goes through fulfilment steps, partly or fully; changes and
cancellations with rules per stage. Technical: a job or request lifecycle, a build or
deploy pipeline run.
Anti-signal: a single immediate action.
Deciding question: is there a request that is fulfilled over time, in steps, and can
change or fail on the way?

**Plan vs actual — the delta**
Signals: a schedule and its execution; deviations; forecasts against reality.
Technical: desired vs actual state and a reconciliation loop (Kubernetes, Terraform),
SPEC vs VERIFY.
Anti-signal: only the actual state matters.
Deciding question: are both the plan and the actual kept, and is the difference itself
a thing to act on?

**Matching — pairing two sets**
Signals: assign X to Y under constraints; best fit; knapsack. Technical: a scheduler,
bin packing, load balancing.
Anti-signal: a fixed mapping.
Deciding question: must the system choose pairs or a selection from options, under
constraints, often for a best result?

**Pipeline — a chain of transformations** (mostly technical)
Signals: data passes through stages; each stage is independent and composable;
stages are added or reordered. Technical: a compiler, ETL, middleware, a build.
Anti-signal: one transformation in one place.
Deciding question: is the work a sequence of independent stages, each with the same
input/output shape?

## Output

```
## Archetype check — <area>
Fits:     <archetype>: <the evidence from the problem, in its own words>; gives: <known structure, traps, questions>
Unclear:  <archetype>: Q: <question> — fits if <answer>
Checked, no fit: <list>
```

In a task: a fit goes to **Design** in `SPEC.md` as a named shape; its known traps become
questions for the grilling tree. Propose deepening one archetype at most.
