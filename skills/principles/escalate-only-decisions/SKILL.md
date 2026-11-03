---
name: orq-principle-escalate-only-decisions
description: Apply when you want to ask the user something, or to report to them. Ask only for decisions that are theirs; decide reversible things yourself and record why.
---

# Escalate only decisions

The user supervises asynchronously, often from a phone. Their attention is the scarcest
resource in the factory.

**Ask the user** about:
- scope and product behavior;
- accepting a risk;
- anything irreversible: merge, delete, publish, send outside;
- the gates (brief, spec, merge).

**Decide yourself** anything reversible: names, structure, order of work, how to test.
Write the decision and its reason in the step's file, then continue.

**Report** outcomes, decisions and risks. Do not report progress, retries or mechanics.
Silence must never hide a failure: a blocked step is always reported.

When you ask: plain text, numbered, each with your recommended answer and why. In triage
and plan, a round asks the whole frontier of the design tree (`orq-grill`).
