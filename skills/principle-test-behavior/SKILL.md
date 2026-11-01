---
name: principle-test-behavior
description: Apply when you write, change or keep a test. Assert what the code's users can observe, so that the test fails when that behavior breaks and keeps passing when only the internals change.
---

# Test behavior, not implementation

Behavior is what a user of the code can observe through its interface: return values,
errors, state they can read back, effects on outside systems (a request sent, a row
written, a message emitted). Everything else is implementation.

Judge each test with two imagined edits:

1. **Break the behavior** (wrong value, skipped effect, effect done twice). The test must
   fail. If it still passes, it proves nothing.
2. **Change only the internals** (same results, new structure). The test must pass. If it
   fails, it is pinned to the implementation.

Keep tests that pass both. Rewrite or delete the rest.

- Test at the agreed seams (`SPEC.md`), through the public interface, with concrete input.
- Take the expected value from the requirement, never from a run of the code or from the
  same formula the code uses.
- Mock only at a real outside boundary. A test that asserts on its own mock proves nothing.
- Red before green: see the new test fail for the right reason before you write the code.
  One test, then its code, then the next.
