---
name: principle-smallest-change
description: Apply when you plan or write a change, judge a diff's size, or want to add an abstraction, a layer, a flag or an option. Make the smallest change that solves the problem, and remove before you add.
---

# Smallest change (YAGNI)

- Solve the stated problem. Do not build for needs the spec does not have.
- Fewer lines beat "elegant" boilerplate. A one-caller wrapper is a layer to remove.
- Remove first: dead code, duplicate checks and stale references go before you build on
  top of them.
- One decision, one place. Do not repeat the same choice in several files.
- A new abstraction must remove something: branches, duplicated rules, invalid states.
  If it only adds indirection, do not add it.
- When you are unsure if something is needed, leave it out and write it down as a
  follow-up.
