---
id: T-0002
created: 2026-11-24T08:36:13.398Z
---

Task sessions must always be reachable in the Herdr app, one space per project. Today a task terminal can start with no herdr.space label (spaceLabel in packages/cli/src/herdr.ts fails silently and returns []), so the app shows no tab and the only way in is hc attach. Seen live: meal-prep T-0001 (terminal orq-t-0001) had labels {} although orq new ran from a terminal in the 'meal-prep' space. Wanted: (1) a project's Herdr space defaults to the repo directory name; herdr_session in .orqestrai/config.toml only overrides it. (2) orq never starts a task terminal without a space label silently: if the project's space is not open in the app, say so and tell the user how to open it and then orq resume. (3) Find out why the label was missing for T-0001 and fix the root cause. (4) Task sessions inside Fence (ORQ_SANDBOX='fence --') stop at Claude's 'trust this folder' dialog, although DESIGN.md says orq pre-trusts each worktree; make the pre-trust work where Claude inside the sandbox reads it.
