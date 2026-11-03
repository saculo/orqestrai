---
name: orq-problem-class
description: orqestrai modeling tool. Puts one operation into one of four problem classes - CRUD, transformation & presentation, integration, resource contention - so the plan picks the right building blocks and test strategy, and neither over- nor under-engineers. Works for business and technical code. Loaded by orq-plan, once per operation.
---

# orqestrai: problem class

An **operation** is one thing the system does when called: a command, an endpoint, a job,
an event handler, a CLI command, a public library function. Classify each operation the
task adds or changes. The class says which building blocks it likely needs and how to
test it. It is a starting point, not a law: when there is a reason to deviate, record it
in **Design**.

**Not applicable:** some changes add or change no operation — an algorithm, a performance
fix, a refactor, a parser's internals, build and tooling, rendering details. Do not force
a class on them. Write `n/a — <why>` and move on.

## The deciding questions

Ask them in this order. The first "yes" decides.

1. **Does the operation change any state?** No → **transformation & presentation**.
2. **Is the hard part the coordination with another component or an outside system** —
   the contract, the order of steps, what happens when the other side fails? Yes →
   **integration**.
3. **Is "is this allowed?" decided on data that another call can change at the same
   moment?** Yes → **resource contention**.
4. Otherwise → **CRUD**.

Question 3 is the one that is easy to get wrong. The quick test: *are all the values I
check part of this call, or can another caller (a user, a process, a thread) change one
of them right now?* Heavy validation of the call's own input is still CRUD. One shared
value that a concurrent call can change makes it contention.

Most answers come from the brief and the code. Ask the user only what neither settles,
usually question 3: "Can two callers do <this> to the same <thing> at the same time?
What should happen then?"

## The classes

### CRUD — a notebook

Data is stored and read back as it was given. No rule based on the system's state can
refuse the operation, and saving it changes nothing else.

- **Blocks:** entry point → storage. A service layer or domain objects here are
  over-engineering. Extracting logic later is cheap.
- **Tests:** integration, with the real store. Saving and reading back through the API
  *is* the behavior. Complex input validation can get its own unit tests.
- **Disguised CRUD:** one screen or one record can mix descriptive fields (title, notes)
  with fields governed by rules (status, approval). Split them into two operations: CRUD
  for the first, its own class for the second. When the rules must block an edit, the
  rule side exposes a query ("can this be edited?"); when an edit matters to the rules,
  send what changed and let the rule side decide.

*Business:* edit a project's title and description.
*Technical:* save a user's editor settings to a config file.

### Transformation & presentation — a projection

Reads existing state or input and shapes it: a view, a report, a search, an export, a
compiler pass, a formatter. Changes no state.

- **Blocks:** functions composed into a pipeline; a query, a façade, or a read model.
  No aggregates: there is no state to protect.
- **The rule:** the result can always be rebuilt from the sources. A read model or a
  cache can be deleted and rebuilt; never use it to decide a write.
- **Tests:** build the source state through the sources' own APIs (or give the input),
  then assert on the output. Unit tests for functions with many variants.

*Business:* a calendar that shows the reservations of a week.
*Technical:* `orq ls` — read the task rows and print a table.

### Integration — between components

The rules inside each side are simple. The problem is between them: contracts, order,
duplicates, timeouts, partial failure.

- **Blocks:** an explicit contract per boundary; idempotent handling; a decision for each
  failure (retry, compensate, give up and report); an outbox or similar when a state
  change and a message must both happen.
- **Tests:** contract tests per boundary; network-level doubles for third-party
  services; integration tests for the failure paths (timeout, duplicate message, out of
  order, the second step fails after the first succeeded); the eventual-effect pattern
  for results that arrive later.
- Each side of an integration can have its own class. Classify them apart.

*Business:* after a shipment leaves, send the invoice data to the accounting system.
*Technical:* `orq new` — a branch and a worktree in git, a row in SQLite, a zellij tab.
What if git succeeds and the insert fails?

### Resource contention — a shared, limited thing

Several callers compete for something limited, and a rule must hold even when they come
at the same moment. The callers can be users, processes, or threads in one process.

- **Blocks:** a consistency unit that locks exactly what the rule needs and nothing more.
  Load `orq-consistency-unit` to design it.
- **Tests:** unit tests for the decision itself (pure, given the data the rule needs);
  a race test: two concurrent calls, the rule holds, the loser gets a clear answer.
  Assert through the API, not on lock internals.

*Business:* book the last free seat on a flight.
*Technical:* `orq new` gives each task the next id. Two runs at the same moment must not
get the same id. Or: a pool hands out a limited number of worker slots.

## Code tells you how it works today

When you classify an existing operation from the code, the code is evidence of how it
works **now**, not of how it should. Say so when they differ: contention implemented as
CRUD with no lock is a risk for **Risk**; CRUD wrapped in heavy layers is a
simplification candidate, not a task to add.

## Output

One row per operation in the **Operations** table of `SPEC.md`:

```
| <operation> | <class, or n/a> | <the answer that decided it> |
```

The class then shapes the behaviors (level, pattern) and the tasks.
