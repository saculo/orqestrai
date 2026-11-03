---
name: orq-principle-sequence-verifiable-units
description: Apply when you split work into tasks and waves, run a series of similar edits, or order commits. Make small units that each end in a state you can check, and check each one before the next.
---

# Sequence verifiable units

A break found at the unit that caused it is cheap to find. A break found after a batch is
buried under work built on top of it.

- **Plan:** each task ends in a checkable state: a test goes green, a command gives the
  expected output.
- **Do:** known-good state → one change → run the check → next. Do not advance on red.
- **Deliver:** order commits so they prove the work: the failing test, then the fix;
  the removal, then the new shape. Each commit stands on its own.
