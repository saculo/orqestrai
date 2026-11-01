---
id: {{id}}
status: draft
risk: low | medium | high
---

# <Summary>

## Acceptance criteria
- **AC1** <observable behavior>

## Seams
- `<signature / endpoint / command>`: <what tests there catch>

## Design
- <decision>, because <reason>. (ADR-xxxx if it applies)

## Tasks
### Wave 1
- **W1.1** <what>. Touches: <files/modules>. Serves: AC1. Tests at: <seam>.

### Wave 2
- **W2.1** <what>. Touches: <files/modules>. Serves: AC2. Tests at: <seam>.

## Verification plan
| Check | Claim | Kind | How (what a user does) | Evidence |
|-------|-------|------|------------------------|----------|
| V1    | AC1   | e2e  | <steps>                | <screenshot, response> |

## Risk
<level>: <reasons>. Blast radius: <what can break>. Priority: <why now>.
