---
id: {{id}}
status: draft
risk: low | medium | high
---

# <Summary>

## Open decisions
<The design tree while grilling: D<n> <decision> (depends on …). Empty when the spec is
done.>

## Decisions
- Q1 <decision>: <answer>

## Acceptance criteria
- **AC1** <observable behavior, checkable on its own>

## Operations
| Operation | Class | Why |
|-----------|-------|-----|
| <command / endpoint / job> | CRUD / transformation / integration / contention | <the deciding answer> |

## Seams
- `<signature / endpoint / command>`: <what tests there catch>

## Behaviors
- **B1 (AC1)** <one sentence in glossary words>.
  Given <state, built through the API>. When <action>. Then <what is observed>.
  Level: unit | integration | contract | e2e (written in verify). Seam: <seam>. Pattern: <hard-to-test pattern, or none>.

## Design
- <decision>, because <reason>. (ADR-xxxx if it applies)

## Tasks
### Wave 1
- **W1.1** <what>. Touches: <files/modules>. Serves: AC1. Tests: B1.

### Wave 2
- **W2.1** <what>. Touches: <files/modules>. Serves: AC2. Tests: B2.

## Verification plan
| Check | Claim | Surface | Kind | How (what a user does and sees) | Evidence |
|-------|-------|---------|------|---------------------------------|----------|
| V1    | AC1   | api     | e2e  | <steps>                         | <the e2e test; a response> |

<!-- Kind: e2e (a committed test, the default) | driven (the verifier drives the app by
hand; say why it cannot be a test) | manual (the user, at the PR; say why). -->

<!-- Surface: the part of the app a check drives (api, web, cli, …). Each surface has a
verify skill, .claude/skills/verify-<surface>/, that says how to drive it. -->

## Risk
<level>: <reasons>. Blast radius: <what can break>. Priority: <why now>.

## Assumptions
- <anything still assumed; "none" when none>

## Impl notes
<Written in impl, after approval: reversible decisions the spec did not give.
`<W1.2>: <decision>, because <reason>`. Empty at the gate.>
