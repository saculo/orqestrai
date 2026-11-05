---
name: orq-triage
description: orqestrai triage step. Turns a request into neutral research, checks what already exists, recommends, then grills the user into an approved BRIEF.md. Loaded by orq-task; do not run it alone.
---

# orqestrai: triage

Input: `.orqestrai/tasks/<id>/REQUEST.md`.
Output: `RESEARCH.md` and `BRIEF.md` in the same folder; `GLOSSARY.md` changes; for a
rejected feature, a file in `.orqestrai/out-of-scope/`.

Goal: a brief so clear that no step after this one needs new information from the user.
The brief describes the problem, not the solution. Acceptance criteria come in plan.

Load `orq-principle-model-the-domain`, and for a bug `orq-principle-fix-root-causes`.

## 1. Read and check what exists

Read `REQUEST.md`, `CLAUDE.md` / `AGENTS.md`, `GLOSSARY.md` and the titles in `docs/adr/`,
if they exist. Look at the code only enough to name the areas involved.

Two checks:

- **Already built?** Search for the requested behavior **by domain concept**, not by the
  request's words ("night theme" is the same concept as "dark mode"). Note where you looked.
- **Rejected before?** Read `.orqestrai/out-of-scope/*.md`. Match by concept, not by
  keyword. Also read what dropped tasks left in the archive (`orq clean` keeps it there):
  `${ORQ_HOME:-~/.orqestrai}/archive/<repo folder name>/*/BRIEF.md` and
  `.../archive/<repo folder name>/*/out-of-scope/*.md`.

## 2. Write neutral research questions

Write 2–7 questions about how the code works **today**:

- Ask what exists, where it is, and how it behaves: data flow, tests, constraints,
  edge cases.
- Give concrete starting points: paths, module names, commands.
- **Do not put the requested change in the questions.** A researcher who knows the wanted
  change finds what supports it and misses what contradicts it.

Example. Request: "add retries to the webhook sender". Good: "How does the webhook sender
handle a failed HTTP call today, and where is that tested?" Bad: "Where should retries go
in the webhook sender?"

## 3. Research

Start the `orq-researcher` subagent with **only the questions**. Do not pass the
request. For separate areas, start 2–3 researchers in parallel, each with its own
questions.

Run `orq file <id> RESEARCH` and fill it: each question, the finding as a header that
states what is true, and the evidence (`path:line`). Check one or two key citations
yourself.

## 4. Check the claim

- **Bug:** reproduce it, if it is cheap. Record: confirmed (with the code path), not
  reproduced, or not enough detail.
- **Feature:** step 1 told you whether it exists. If it does, find where.

## 5. Recommend, then grill

Run `orq file <id> BRIEF`. Load `orq-grill`. Answers go into the brief's
**Decisions** section.

**Q1 is always your recommendation**, before any deep question:

```
Q1 - My reading: <category>. <confirmed / not reproduced / already exists in X /
rejected before in out-of-scope/Y>. Recommended: <do it, scoped to …> / <drop it, because …>.
Proceed on this basis?
```

It stops the work early on a task the user would drop. Put the first frontier in the
same message.

Grill until the problem and its scope are clear:

- current behavior, and the desired behavior with its edge cases and errors;
- who sees the change and when;
- what is in scope and what is not.

Do not grill design (seams, data structures, tasks). That is plan.

## 6. Finish

**Do it:** fill every section of `BRIEF.md`. Name interfaces, not file paths: paths go
stale. Show the user a short summary of the brief and ask for approval. That is the gate.

**Drop it** (the user agreed):

- **Already built:** say where it lives. No out-of-scope file: it was built, not rejected.
- **Rejected feature:** write or update `.orqestrai/out-of-scope/<concept>.md` (one file
  per concept, kebab-case name):

  ```
  # <Concept>

  <What this project does not do, in one sentence.>

  ## Why
  <A durable reason: scope, a technical constraint, a strategic choice. Not "no time now";
  that is a deferral, not a rejection.>

  ## Requests
  - <task id>: "<request in one line>"
  ```

  If the file exists, add the task to **Requests**.
- Commit the out-of-scope file on the task branch. A dropped task is never merged:
  `orq clean` copies the file to the archive, where the next triage reads it. Run `orq state <id> triage DROPPED "<reason>"` and tell the
  user. The task ends here.

When a match in out-of-scope comes up and the user changes their mind, delete or update
that file and continue the triage.
