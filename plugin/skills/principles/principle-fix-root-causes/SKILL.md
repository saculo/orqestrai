---
name: principle-fix-root-causes
description: Apply when you debug or triage a bug. Trace the symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
---

# Fix root causes

The symptom is where a wrong state became visible. The root cause is the first place the
system did something it should not, or failed to handle a state it should handle.

- Reproduce first.
- Ask "why" at each step until the answer is a wrong decision in the code, not a
  consequence of an earlier one.
- Read the actual error and the actual state. Do not guess. Add instrumentation when you
  are stuck.
- Is the triggering state legitimate? If yes, the code that broke on it is the cause.
  If no, find what produced the state. A guard where it broke only hides the bug.
- Guards, retries, swallowed errors, clamped values: these are the usual ways to hide a bug.
- After a restart-only failure, suspect persisted state first: config, caches, locks.
- Fix the pattern, not only the instance. Search for the same fault elsewhere.
