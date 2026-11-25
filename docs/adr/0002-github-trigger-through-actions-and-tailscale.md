# 2. The GitHub trigger goes through Actions and Tailscale; the server pushes starts to `orq watch`

**Status:** accepted (T-0003)

## Context
A label on a GitHub issue should add a task and start it. The sessions' machine and
orq-server sit on a private network, and orq-server runs no command. The old way, `orq issues`,
polled GitHub every minute for issues of one user. It needed `gh` on the machine and could
only trust one author.

## Decision
- A reusable workflow runs in GitHub Actions on `issues: labeled`. It joins the tailnet as
  `tag:orq-ci` and runs `orq trigger github`, which posts the rendered request to a trigger
  port of orq-server.
- The trigger port is its own listener: one route (`POST /github/issues`), a bearer token, and
  a Tailscale policy that lets `tag:orq-ci` reach only that port. The API and dashboard stay
  private.
- The port only adds a backlog task. `orq watch` on the sessions' machine keeps an SSE stream
  (`GET /starts`) open and runs `orq start` for each task. The server never runs a command.

## Consequences
- No port is open to the internet and no GitHub secret is on the sessions' machine. The job
  needs a Tailscale OAuth client and the token as repo secrets.
- Anyone who can add the label can start a task, and the issue's text is the agent's request.
  The label is the review.
- A start waits while `orq watch` is not running; it runs when `orq watch` connects.
- `orq issues` and `[github] user` are gone. `orq init` does not write the workflow; the
  project writes the caller, the automation file and the secrets by hand.
