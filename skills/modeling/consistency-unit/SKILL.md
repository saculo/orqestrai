---
name: orq-consistency-unit
description: orqestrai modeling tool. Designs the consistency unit (aggregate) for a resource-contention operation through five questions - commands, conflicting pairs, the invariant, the smallest data, the lock. Loaded by orq-plan only when orq-problem-class says resource contention.
---

# orqestrai: consistency unit

A consistency unit is **a lock**, not an object-oriented pattern. Its one job: lock what
a rule needs, and leave everything else free to run in parallel. Too big, and unrelated
calls wait for each other. Too small, and the rule breaks under load.

It applies to any shared, limited, changing thing: a seat, a budget, a counter, a file,
a cache key, a lease on a worker. The callers can be users, processes, or threads in one
process.

Use it only when `orq-problem-class` gave **resource contention**. The five
questions below go into the grilling tree (`orq-grill`). Find the facts in the
code yourself; ask the user about rules and about what should happen in a conflict.

## 1. Which commands change this data?

List every command that writes the data the rule reads, also the ones outside this
task. A command you miss is a hole in the lock.

*Example, flight seats:* `ReserveSeat`, `CancelReservation`, `ChangeAircraft`,
`BlockSeatForCrew`.
*Technical, task ids in orq:* `orq new` writes the next id. Nothing else writes it.

## 2. Which pairs conflict?

Take the commands two by two. A pair conflicts when running both at the same moment can
break the rule. Ask for each pair: *if both arrive in the same millisecond, can the
result be wrong?*

| Pair | Conflict? | Why |
|------|-----------|-----|
| ReserveSeat × ReserveSeat (same seat) | yes | both can see "free" |
| ReserveSeat × ReserveSeat (other seats, plane not full) | no | different seats |
| ReserveSeat × ReserveSeat (last free seat) | yes | capacity |
| ReserveSeat × CancelReservation | no | cancel only frees |
| ReserveSeat × ChangeAircraft | yes | capacity changes |

*Technical:* `orq new` × `orq new` conflicts: both read the same highest id, and the
second one fails late, after its worktree exists.

Only conflicting pairs need the lock. A pair with no conflict is free parallelism: keep
it free.

## 3. Which invariant breaks?

Name the rule that a conflicting pair breaks, in one sentence, in glossary words. It
must hold after every command, always.

*Example:* "A flight never has more reservations than seats." "One seat has at most one
reservation." *Technical:* "Two tasks never share an id."

Ask the user when the rule is soft: "Is overbooking by 2% allowed?" "Is a seat held for
10 minutes during payment?" A soft rule can change the whole design.

## 4. What is the smallest data the check needs?

The unit holds only the data the invariant reads, not everything that belongs to the
noun. "Flight" has a route, a crew, meals and prices; the capacity rule needs the seat
count and the reservation count, nothing more.

- Smaller data → smaller lock → less waiting.
- When two invariants need different data, they are often two units.
- When one invariant needs data from many places, ask whether the rule is real, or
  whether a later check and a correction (an apology) is acceptable.

*Technical:* the id rule needs only the counter (or the highest id), not the rest of the
task row.

## 5. Optimistic or pessimistic lock?

- **Optimistic** (a version number, retry on conflict): when conflicts are rare. Cheap,
  no waiting. A conflict costs a retry or an error to the user.
- **Pessimistic** (lock first, then check): when conflicts are frequent on hot data
  (the last seats before departure) and a retry storm would cost more than waiting.
- **No lock, a unique constraint** in the store: when the invariant is simple uniqueness.
  Often the smallest correct answer.
- **Atomic in the store:** read and write in one statement or one transaction (allocate
  the id and insert the row together). For `orq new` this is the answer: the worktree is
  created only after the id is held.

Inside **one process** (threads, async tasks, shared memory) the same question has other
tools: an atomic value, a mutex around the smallest section, a single writer (an actor or
a queue that owns the data), or immutable data with copy-on-write. Prefer a single writer
or an atomic; a mutex held across slow work is the in-process "too big a unit".

Ask the user about load only when it decides between them: "How many calls per second
can hit the same flight at peak?"

Also decide what the **loser** of a conflict sees: an error, a retry, an alternative
("seat 12C was taken; 12D is free").

## Output

In `SPEC.md`:

- **Decisions:** the answers, question by question.
- **Design:** one entry per unit:

  ```
  - Consistency unit <name>: protects "<invariant>". Holds <data>. Locked by
    <commands>. Lock: <optimistic / pessimistic / unique constraint>, because <reason>.
    Loser sees: <answer>.
  ```

- **Behaviors:** the invariant as a unit test of the decision, and a race test
  (integration): two conflicting commands at once, the invariant holds, the loser gets
  the agreed answer.

When the choice is hard to reverse and surprising (for example, two units instead of
the obvious one), offer an ADR (see `orq-grill`).
