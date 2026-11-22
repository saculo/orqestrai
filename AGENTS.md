# orqestrai

The orq CLI and server (`src/`, TypeScript on Bun with Effect), its tests (`test/`), and the
Claude Code plugin (`plugin/`). The design is in DESIGN.md.

## Checks

Run from the repository's root, in this order; each must pass:

```bash
bun run check      # types
bunx biome ci .    # lint and format
bun test           # tests
```
