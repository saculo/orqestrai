# 1. orq writes the folder-trust entry into Claude's own config

**Status:** accepted (T-0002)

## Context
Claude Code asks "do you trust this folder?" the first time it runs in a folder. A task
session started by orq would stop at that dialog, in Fence or not. The answer lives only in
Claude's config file (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`), at
`projects[<folder>].hasTrustDialogAccepted`. The file belongs to Claude, and running Claude
sessions rewrite it.

## Decision
`orq new` and `orq resume` set `projects[<worktree>].hasTrustDialogAccepted = true` before the
session starts; `orq clean` deletes `projects[<worktree>]`. orq touches only that entry, and:
- writes a temp file in the same directory and renames it, so no reader sees half a file;
- keeps the file's mode (0600 for a new file: it holds account data) and edits a symlink's
  target, not the link;
- leaves a file that is not a JSON object as it is, with a warning (the dialog then shows).

## Consequences
- No trust dialog in task sessions. orq depends on an undocumented key of Claude's config: if
  Claude moves it, the dialog comes back (nothing breaks).
- A Claude process writing the file at the same instant can lose orq's entry or lose its own
  update. Accepted as rare; `orq resume` writes the entry again.
- Tests must never write the real file: `test/orq.ts` points `CLAUDE_CONFIG_DIR` at a temp dir.
