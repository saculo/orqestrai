---
name: context-distilling
description: orqestrai modeling tool. Settles a term that means two things, or a concept nobody can place - split it into two terms, merge different names into one, or name the context it belongs to. Writes GLOSSARY.md only. Loaded by orq:grill only on that signal.
---

# orqestrai: context distilling

Load this only on a signal while grilling:

- a term from the request or the code clashes with `GLOSSARY.md`;
- two people (or the code and the user) use one word for different things;
- different words seem to name the same thing;
- nobody can say where a concept belongs.

If none of these is true, do not use it. One clear concept in one context is modeled
directly.

## The idea

A word is the same concept only where it **behaves** the same: the same rules, the same
commands, the same life. Behavior decides, not the noun.

- **Same word, different behavior** → two concepts. Give each its own term.
- **Different words, same behavior** in one process → one concept. Pick one term, list
  the others under _Avoid_.
- Generalizing stops where one process needs a rule the others do not have.

## The questions

Ask them as part of the grilling tree (`orq:grill`). Look up in the code what you
can first: who uses the word, which commands touch it.

**1. Which processes use this term?** List them: where it is created, changed, read,
ended.

*Example, "Order":* sales takes the order; the warehouse picks it; billing invoices it.

**2. Do the rules differ between these processes?** For each process: what can happen to
the thing, what is not allowed, when it ends.

*Example:* in sales an Order can change until it is confirmed; in the warehouse, the
"order" is a pick list that can be split across shipments; billing only cares about
amounts and the customer. Three behaviors → three concepts: **Order**, **Pick List**,
**Invoice Request**.

**3. Different names, same behavior?** For each pair of words that looks alike: do they
go through the same steps under the same rules in this process?

*Example:* "trainer", "room" and "projector" all need booking for a time slot, with no
double booking. In the scheduling process they behave the same: one concept,
**Bookable Resource**. Outside it, a trainer has skills and a contract; that stays a
different concept in its own context.

**4. Where does it belong?** For a concept nobody can place: which process owns its
rules (who decides what is allowed)? It belongs there. Other processes refer to it by
its identifier or by a copy they own, not by sharing its rules.

## Output

`GLOSSARY.md` only. Update it at once when a term is settled:

```
## <Term>
<What it is, in this context, in one or two sentences.>
_Avoid_: <the other words>
```

- A split: two entries, each says which process it lives in, each lists the other's
  word under _Avoid_ when the two get confused.
- A merge: one entry, the merged words under _Avoid_.
- No implementation details: no tables, classes or services.

When the split is large (a new context, files that must move), it is not this task's
job. Record it under **Assumptions** or as a proposal for learn.
