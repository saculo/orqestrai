# orq init writes the GitHub workflow caller

`orq init` writes only `.orqestrai/config.toml`: not the GitHub Actions caller of the label
trigger, an automation file, or its secrets.

## Why
The user chose to set the trigger up by hand from the README (the caller, an automation file,
the `gh secret set` lines): a project that has not set the secrets would otherwise get a red
run on every label, and what a project triggers on is its owner's choice.

## Requests
- T-0003: "orq init writes a short caller of the reusable workflow" (plan, Q14: no)
