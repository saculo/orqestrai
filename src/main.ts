// orq's entry point, for `bun src/main.ts` and for the compiled binary (`bun run build`).
// `orq guard` runs before every tool call, so it skips the Effect CLI and starts fast.
if (process.argv[2] === "guard") void import("./guard/main.ts").then((guard) => guard.main())
else void import("./cli.ts")
