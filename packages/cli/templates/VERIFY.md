---
id: {{id}}
status: draft
round: 1
---

# Verify: <summary>

<!-- status: draft | passed | failed | escalated. One "Round" section per round; keep old rounds. -->

## Round 1

### Quality gate
| Command | Result | Evidence |
|---------|--------|----------|
| types   | pass / fail / not configured | <command and the last lines of its output> |

### Checks (verifier)
| Check | Claim | Verdict | Evidence |
|-------|-------|---------|----------|
| V1    | AC1   | VERIFIED / NOT VERIFIED / INCONCLUSIVE | <what was done and seen; file in evidence/> |

### Review (reviewer)
**Hypotheses:** <2–4, written before reading the diff>

**Prior findings:** <round 2+: each one fixed / not fixed / no longer applies>

| # | Axis | Finding | Confidence | Blocking | Where |
|---|------|---------|------------|----------|-------|
| R1 | Standards / Spec | <one sentence> | 75–100 | yes / no | <file:line> |

### Outcome
<passed | back to impl: the failing items | escalated: why>

Root causes: <one line per failure: step:kind:first-location>

## For the PR body
- <non-blocking findings, kept for ship>
