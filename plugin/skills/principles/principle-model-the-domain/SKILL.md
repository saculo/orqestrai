---
name: principle-model-the-domain
description: Apply when you name things, design data, write stateful logic, or see code that branches a lot or repeats one shape across files. Put the domain in a data structure and in shared words (GLOSSARY.md).
---

# Model the domain

**Words.** Use the terms in `GLOSSARY.md` in code, tests, specs and messages. When a new
term is settled, add it there. When you see a word listed under _Avoid_, use the term.

**Structures.** Put the domain in a data structure instead of in scattered conditionals.

- A state machine instead of several booleans or phase checks.
- A typed model instead of loose parameters or repeated shape assumptions.
- A table, map or tagged union instead of the same `if`/`switch` in many places.
- A module around one body of domain knowledge, not around steps such as
  load → validate → save.

Signs you skipped this: a new feature adds one more branch to an existing chain; a second
boolean must stay in sync with the first.

Do not force it. If the current shape is clear, local and unlikely to grow, keep the
plain code.
