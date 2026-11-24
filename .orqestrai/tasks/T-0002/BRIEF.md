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
- D1 Proceed on this reading (Q7). (nothing)
- D3 What orq new / orq issues / orq resume do when the project's space is not open (Q8). (settled D2)
- D5 Stale install: what part of the T-0001 root cause this task fixes (Q9). (nothing)
- D7 A running unlabelled task terminal on orq resume (Q10). (settled D2)

**Decisions:**
- Q1 Proceed on this reading: user asked for the bugs explained first; re-asked as Q7.
- Q2 Which space: only the project's space (`herdr_session`, else the repo folder name); no fallback to the space orq runs in or any open space.
- Q3 Space not open: unclear to the user; re-asked as Q8.
- Q4 Other hc failures: orq stops with hc's message and starts nothing; hc not installed stays as today (the command to run by hand).
- Q5 Stale install: unclear to the user; re-asked as Q9.
- Q6 Pre-trust: at orq new and resume orq writes the worktree's trust entry in `~/.claude.json`; orq clean removes it.

**Assumptions:**
- "Herdr space" and the app's "session" (hc's `where`, the `herdr.space` label) are one thing; the brief says space.
- hc not installed keeps today's behavior: orq prints the command to start the session by hand.
