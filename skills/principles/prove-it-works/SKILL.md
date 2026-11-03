---
name: orq-principle-prove-it-works
description: Apply before you say a task, a fix or a check is done. Prove it on the real artifact - run the feature, read the actual value, look at the diff - not on a proxy, a self-report, or "it compiles".
---

# Prove it works

Check the real thing directly. Do not infer from proxies.

- Run the feature the way a user does. Read the actual output, value, row or file.
- An agent's report is a claim, not evidence. A green CI run proves only what it ran.
- "Inconclusive" or "checked on the wrong surface" is not a pass. Say so.
- When a check fails, suspect the check first, then the system.
- Script the check when you can, so another agent can run it again and get the same
  result. Keep its output as evidence.
- Every claim of "done" names its evidence: the command and its output, a screenshot,
  a response.
