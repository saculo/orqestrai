---
name: principle-attack-the-premise
description: Apply when two or more fixes that share one assumption have failed the same check - for example in the impl-verify loop. Write the assumption down and test it before you write another fix.
---

# Attack the premise

Each failed fix is evidence against the belief it assumed. A third fix on the same belief
spends effort where the evidence already says the cause is not.

1. **Write the premise down:** the one sentence every failed fix assumed.
2. **Test it before the next fix:** find an observation that would differ if the premise
   were false, and make it. Make the check repeatable.
3. **Follow the evidence.** If it contradicts the premise, look for what the failures have
   in common. If it confirms it, ask the next "why" (`principle-fix-root-causes`).
4. **Remove the condition** instead of adding a mechanism that cleans up after it.

Do not start the next fix before the premise is written down and tested.
