---
name: principle-boundary-discipline
description: Apply when you write validation, error handling, parsing or framework wiring. Validate at system boundaries, trust typed data inside, keep business logic in pure functions.
---

# Boundary discipline

- **At boundaries** (CLI arguments, config, HTTP, external APIs, files, messages):
  validate, parse into domain types, return clear errors.
- **Inside:** trust the types. Do not check again what the boundary already checked.
- **Across a boundary:** expose domain concepts, not the transport's or storage's own types.
- Business logic in pure functions. The shell around it is thin and mechanical, so the
  logic can be tested without the framework.

Two tests:

1. Is this data crossing a boundary right now? If not, the validation is redundant.
2. Can this be a pure function that the shell calls? If yes, extract it.
