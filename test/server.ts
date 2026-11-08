// `orq serve` for a test: started on a Unix socket with the database's PG* variables, so the
// orq runs under test can reach the state through ORQ_SERVER and hold no PG* variable themselves.
import { resolve } from "node:path"
import type { Subprocess } from "bun"

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts")

/** process.env without any PG* variable: what a client of the server has. */
export const withoutPg = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PG")))

export const startServer = async (socket: string, env: Record<string, string>): Promise<Subprocess> => {
  const server = Bun.spawn([process.execPath, CLI, "serve", "--socket", socket], {
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "pipe",
  })
  for (let i = 0; i < 100; i++) {
    const up = await fetch("http://orq/slots", { unix: socket } as RequestInit).then(
      (r) => r.ok,
      () => false,
    )
    if (up) return server
    await Bun.sleep(100)
  }
  server.kill()
  throw new Error(`orq serve did not start: ${await new Response(server.stderr).text()}`)
}
