// orq's entry point, for `bun src/main.ts` and for the compiled binary (`bun run build`).
// `orq guard` runs before every tool call, so it skips the Effect CLI and starts fast.
if (process.argv[2] === "guard") void import("./guard/main.ts").then((guard) => guard.main())
// the settings file fills in the ORQ_* variables first (the guard needs none of it)
else
  void import("./settings.ts").then(({ loadSettings }) => {
    loadSettings()
    return import("./cli.ts")
  })
