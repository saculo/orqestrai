# Testing

- Run: `bun test` from the repository root. Every CLI test runs the real `orq` command as a
  process (`test/orq.ts`: from source, or `ORQ_BIN`).
- **Timeouts are not failures.** On a loaded 1-CPU machine, a varying set of CLI tests in
  `test/orq.test.ts` and `test/dashboard.test.ts` hit bun's 5000 ms default, on main too.
  Before calling a test red, run `bun test --timeout 60000`; only what fails then is real.
- **hc:** `ORQ_HC` points orq at a fake `hc` script (see `test/herdr.test.ts`); it logs its
  calls and env and can fail `ls` / `get` per test. `ORQ_HC=orq-test-no-hc` (`test/orq.test.ts`) means hc is
  not installed.
- **Claude's config:** `test/orq.ts` sets `CLAUDE_CONFIG_DIR` to a fresh temp dir, so no test
  touches the real `~/.claude.json`; `test/herdr.test.ts` gives each test its own
  `CLAUDE_CONFIG_DIR` and asserts the trust entries there.
- **orq's settings:** `test/orq.ts` sets `ORQ_CONFIG` to `test/no-config.toml`.
