# The checks CI runs, and orq's quality gate (orq check).
check:
    bun run check
    bunx biome ci .
    bun test
