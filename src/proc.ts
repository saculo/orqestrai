// Running other programs (git, zellij). A non-zero exit is an OrqError.
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { OrqError } from "./domain.ts"

export interface Output {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Run a program and return its exit code and output. Never fails on a non-zero exit. */
export const run = (cmd: string, args: ReadonlyArray<string>, cwd?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(cmd, [...args], cwd === undefined ? {} : { cwd })
      const [stdout, stderr, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
        { concurrency: "unbounded" },
      )
      return { code: Number(code), stdout, stderr } satisfies Output
    }),
  ).pipe(Effect.mapError((e) => new OrqError({ message: `cannot run ${cmd}: ${e.message}` })))

/** Run a program and return its trimmed stdout. A non-zero exit fails with its stderr. */
export const exec = (cmd: string, args: ReadonlyArray<string>, cwd?: string) =>
  run(cmd, args, cwd).pipe(
    Effect.flatMap((out) =>
      out.code === 0
        ? Effect.succeed(out.stdout.trim())
        : Effect.fail(new OrqError({ message: `${cmd} ${args.join(" ")}: ${out.stderr.trim() || `exit ${out.code}`}` })),
    ),
  )
