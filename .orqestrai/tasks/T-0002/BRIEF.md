---
id: T-0002
status: draft
---

# Task sessions always land in the project's Herdr space, or orq says why not; worktrees are pre-trusted

**Category:** bug

**Triage check:** confirmed. (a) `spaceLabel` drops every failure to `[]` and `openSession`
starts the terminal unlabelled with no message. (b) T-0001's unlabelled terminal was started
by a stale global install (built before #35, same version 0.9.0). (c) orq inside Fence cannot
reach hc's socket, another silent `[]`. (d) Worktree pre-trust is in DESIGN.md but was never
built. See RESEARCH.md. Out-of-scope match: none (no out-of-scope files, no archived briefs).

**Current behavior:** <filled after grilling>

**Desired behavior:** <filled after grilling>

**Who sees it:** <filled after grilling>

**Scope:**
- <filled after grilling>

**Out of scope:**
- <filled after grilling>

**Open decisions:**
- D1 Proceed on this reading (Q1). (nothing)
- D2 Space selection: only the project's space, no fallback to the caller's or any session (Q2). (nothing)
- D3 What orq new / orq issues / orq resume do when the project's space is not open (Q3). (D2)
- D4 Other hc failures while finding the space: error, not silent (Q4). (nothing)
- D5 Stale install: what part of the T-0001 root cause this task fixes (Q5). (nothing)
- D6 Pre-trust: write Claude's own trust entry for the worktree (Q6). (nothing)
- D7 A running unlabelled task terminal on orq resume. (D2)

**Decisions:**

**Assumptions:**
- "Herdr space" and the app's "session" (hc's `where`, the `herdr.space` label) are one thing; the brief says space.
- hc not installed keeps today's behavior: orq prints the command to start the session by hand.
