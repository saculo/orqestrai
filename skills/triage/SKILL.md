---
name: triage
description: orqestrai triage step. Turns a request into neutral research, then into an approved BRIEF.md through questions with the user. Loaded by orqestrai:task; do not run it alone.
---

# orqestrai: triage

Input: `.orqestrai/tasks/<id>/REQUEST.md`.
Output: `RESEARCH.md` and `BRIEF.md` in the same folder, and `GLOSSARY.md` changes.

Load these principle skills: `orqestrai:principle-model-the-domain`, and for a bug
`orqestrai:principle-fix-root-causes`.

## 1. Read

Read `REQUEST.md`, `CLAUDE.md` / `AGENTS.md`, `GLOSSARY.md` and the titles in
`docs/adr/`, if they exist. Look at the code only enough to name the areas involved.
Keep this pass small.

## 2. Write neutral research questions

Write 2–7 questions about how the code works **today**:

- Ask what exists, where it is, and how it behaves: data flow, tests, constraints,
  edge cases.
- Give concrete starting points: paths, module names, commands.
- **Do not put the requested change in the questions.** A researcher who knows the wanted
  change tends to find what supports it and to miss what contradicts it.

Example. Request: "add retries to the webhook sender". Good: "How does the webhook sender
handle a failed HTTP call today, and where is that tested?" Bad: "Where should retries go
in the webhook sender?"

## 3. Research

Start the `orqestrai:researcher` subagent with **only the questions**. Do not pass the
request. For separate areas, start 2–3 researchers in parallel, each with its own
questions.

Run `orq file <id> RESEARCH` and fill it: each question, the finding as a header that
states what is true, and the evidence (`path:line`). Check one or two key citations
yourself.

## 4. Check the claim

- **Bug:** try to reproduce it, if it is cheap. Record: confirmed (with the code path),
  not reproduced, or not enough detail.
- **Feature:** check whether it already exists. If it does, tell the user where.
- If the request should not be done, say why and recommend to drop it. The user decides.

## 5. Ask the user

Compare the research with the request. Ask only questions whose answer changes the brief.

- At most 5 questions in one round. Number them. Give your recommended answer and why.
- Create the draft with `orq file <id> BRIEF` before the first round. Write each answer
  into it at once, so a restart loses nothing.
- Stop asking when the scope is clear and every acceptance criterion can be checked.

When a domain term is settled, add or update it in `GLOSSARY.md` (create the file if
needed):

```
## <Term>
<Meaning in one or two sentences.>
_Avoid_: <other words for the same thing>
```

## 6. Finish BRIEF.md

Fill every section of the template. Describe what the system must do, not how to build
it. Name interfaces, not file paths: paths go stale.

Show the user a short summary of the brief and ask for approval. That is the gate.
