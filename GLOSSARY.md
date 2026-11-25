# Glossary

- **Herdr space**: a group of terminals in the Herdr app, shown as one window with tabs. Only
  the app creates spaces. hc calls it a session: the part of a terminal's `where` before
  " / ", and the label `herdr.space`; the config key is `herdr_session`. Say *space*.
- **Project's space**: the Herdr space a project's task sessions open in: `herdr_session` in
  `.orqestrai/config.toml`, else the repository's directory name. It is *open* when at least
  one live terminal is in it (hc cannot list spaces).
- **Task session**: the Claude session orq starts for one task, in the hc terminal
  `orq-t-NNNN`, in the task's worktree. Not a Herdr space.
- **Backlog task**: a task that was added but not started: status TODO and no worktree, branch
  or session. The dashboard shows these as the backlog. _Avoid_: queued task, pending task.
- **Start (a task)**: make a backlog task's branch and worktree from the latest base branch and
  open its task session (`orq start`). A started task is never started again; it is resumed.
