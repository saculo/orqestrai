---
id: T-0002
status: draft
---

# Task sessions always land in the project's Herdr space, or orq says why not; worktrees are pre-trusted

**Category:** bug

**Triage check:** confirmed. (a) `spaceLabel` drops every failure to "no label" and the
session starts unlabelled with no message. (b) T-0001's unlabelled terminal was started by a
stale global install (built before #35, same version 0.9.0). (c) orq inside Fence cannot
reach hc's socket, another silent "no label". (d) Worktree pre-trust is in DESIGN.md but was
never built. See RESEARCH.md. Out-of-scope match: none (no out-of-scope files, no archived
briefs).

**Current behavior:**
- The task session's space comes from `herdr_session` if a terminal is open in that space,
  else the space of the terminal orq runs in, else any open space. Any failure along the way
  (no terminal in the space, hc errors, bad output, no label) starts the session with no
  space label and no message: the Herdr app shows no tab; only `hc attach` reaches it.
- Inside a Fence task session, orq's hc calls cannot reach herdr-core, and fail silently.
- A running task terminal without a label stays without one; `orq resume` leaves it alone.
- No worktree is pre-trusted: every new task session stops at Claude's "trust this folder"
  dialog, in Fence or not.
- The version did not change in #35, so an old install cannot be told from a current one.

**Desired behavior:**
- **The project's space:** `herdr_session` in `.orqestrai/config.toml` if set, else the
  repo's directory name (e.g. `meal-prep`). Nothing else: no fallback to the space orq runs
  in, or to any open space.
- **Space open:** the task session starts with that space's label; the app shows its tab.
- **Space not open** (no terminal open in a space of that name): `orq new` and `orq issues`
  still create the task and its worktree but start no session; `orq resume` starts none.
  orq says which space is missing and what to do, e.g. "no 'meal-prep' space is open in the
  Herdr app: open it, then run orq resume T-0003", and exits non-zero.
- **hc fails** while orq finds the space (an error, unreadable output): orq stops with hc's
  message and starts nothing. hc not installed: as today, orq prints the command to start
  the session by hand.
- **Inside Fence:** orq's hc calls from a task session reach herdr-core as they do outside.
- **Running without a label:** `orq resume` on a task whose terminal runs without the space
  label adds the label, so the tab appears without a restart. A running terminal that has it
  is left alone, as today.
- **Pre-trust:** `orq new` and `orq resume` mark the task's worktree as trusted in Claude's
  own config (`~/.claude.json`) before the session starts, so the trust dialog never shows,
  in Fence or not. `orq clean` removes that entry.
- **Version:** this change ships as 0.10.0, so `orq --version` shows a stale install.

**Who sees it:** the user, whenever a task session starts (`orq new`, `orq issues`,
`orq resume`): the tab in the project's Herdr space, or a message saying why not; no trust
dialog in the session.

**Scope:**
- How the project's Herdr space is named (default: repo directory name).
- Starting, resuming and labelling a task session in that space; the messages when it
  cannot.
- hc calls from inside a Fence task session.
- Pre-trusting each task worktree, and removing the trust entry on clean.
- Version 0.10.0; DESIGN.md and README follow the new behavior.

**Out of scope:**
- An automatic check that the installed orq is current.
- Creating a Herdr space: only the app creates spaces; orq tells the user to open it.
- Moving a running, labelled task terminal to another space.

**Open decisions:** none.

**Decisions:**
- Q1 Proceed on this reading: user asked for the bugs explained first; re-asked as Q7.
- Q2 Which space: only the project's space (`herdr_session`, else the repo folder name); no fallback to the space orq runs in or any open space.
- Q3 Space not open: unclear to the user; re-asked as Q8.
- Q4 Other hc failures: orq stops with hc's message and starts nothing; hc not installed stays as today (the command to run by hand).
- Q5 Stale install: unclear to the user; re-asked as Q9.
- Q6 Pre-trust: at orq new and resume orq writes the worktree's trust entry in `~/.claude.json`; orq clean removes it.
- Q7 Proceed: yes, fix all four bugs in this task.
- Q8 Space not open: the task and worktree are created, no session starts, orq names the missing space and says to open it and run `orq resume <id>`, exit non-zero; the same for `orq resume` and `orq issues`.
- Q9 Stale install: bump to 0.10.0; no automatic staleness check.
- Q10 Running unlabelled terminal: `orq resume` adds the space label.

**Assumptions:**
- "Herdr space" and the app's "session" (hc's `where`, the `herdr.space` label) are one thing; the brief says space.
- A space is "open" when at least one live terminal is in it: hc cannot list spaces, only terminals.
- `orq issues` handles each issue on its own: a missing space is reported for that task, and it goes on with the other issues.
- Claude inside Fence reads the same `~/.claude.json` as outside (Fence's config allows it; not yet observed at runtime, verify proves it).
