---
id: T-0003
created: 2026-11-24T13:57:11.097Z
---

Backlog and triggers: add a task now, start it later, and let a GitHub label add and start it.

Settled design (agreed with the user; grill only what is still open):

1. Two steps. 'orq new "<request>"' only adds: a task row, status TODO, no worktree, no branch, no session. 'orq start <id>' makes the branch and worktree from the latest base branch and opens the session in the project's Herdr space (as T-0002 made it). 'orq start' on a started task is an error that points to 'orq resume'. No limit on how many sessions run at once.
2. The dashboard shows the TODO tasks as the backlog. The dashboard stays read-only; the user starts tasks with orq start.
3. Automations: a project declares its triggers as files, '.orqestrai/automations/<name>.md'. Front matter = the trigger and its filter (e.g. provider: github, event: issue_labeled, labels: [orq], start: true); body = the request template (e.g. the issue's title, body and URL). Idea from Warp's factory (github.com/warpdotdev-demos/warp-learn-factory-checkpoints, automations/*/automation.md). Only the GitHub issue-label trigger now. Error-alert webhooks: later, not in this task.
4. GitHub label trigger: adding the label to an issue adds the task AND starts it. Transport: a GitHub Actions workflow on 'issues: labeled' on GitHub-hosted runners (no self-hosted runner, no Forgejo). It is a reusable workflow in the orqestrai repo; each project has a short caller that 'orq init' writes. The job joins the tailnet with tailscale/github-action (Tailscale OAuth client, ephemeral node, tag:orq-ci) and calls one narrow orq-server endpoint that can only add a task from an issue, protected by a token (orq-server has no auth today; the rest of its API stays as it is). Tailscale ACL: tag:orq-ci reaches only the server's port. The server stores the GitHub repo name (e.g. saculo/meal-prep) and the issue link (gh-issue:<url>); the same issue labelled again adds nothing. The job comments the task id on the issue with its own GITHUB_TOKEN. Never pull_request_target with a checkout of PR code.
5. 'orq watch': a long-running process on the sessions' machine (where hc, the worktrees and the sandbox are). It keeps a connection to orq-server and runs 'orq start' for each task added with start. The server still never runs a command. 'orq start' resolves the checkout of a GitHub repo name from [github] repos.
6. 'orq issues' (polling GitHub every minute) goes away.

Open for the plan: the server-to-watch connection (SSE, long poll, ...), the endpoint's shape and token config, how 'orq init' writes the workflow and the secrets the user must set (gh secret set), docs for the Tailscale ACL.
