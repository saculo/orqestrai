// orq-server for a test, with its own ORQ_DATA, so the orq runs under test reach the state only
// through ORQ_SERVER. On a Unix socket (one machine) or on a TCP address (the server on another machine).
import type { Subprocess } from "bun"
import { ORQ_SERVER } from "./orq.ts"

/** Where to listen: a socket path, or a port on 127.0.0.1; with `alsoPort`, a socket and that port. */
export const startServer = async (
  at: string | number,
  env: Record<string, string>,
  alsoPort?: number,
  cwd?: string,
  triggerPort?: number,
): Promise<Subprocess> => {
  const flags = [
    ...(typeof at === "string" ? ["--socket", at] : ["--host", "127.0.0.1", "--port", String(at)]),
    ...(alsoPort === undefined ? [] : ["--host", "127.0.0.1", "--port", String(alsoPort)]),
    ...(triggerPort === undefined ? [] : ["--trigger-port", String(triggerPort)]),
  ]
  const ping =
    typeof at === "string" ? () => fetch("http://orq/tasks", { unix: at } as RequestInit) : () => fetch(`http://127.0.0.1:${at}/tasks`)
  const server = Bun.spawn([...ORQ_SERVER, ...flags], {
    ...(cwd === undefined ? {} : { cwd }),
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "pipe",
  })
  for (let i = 0; i < 100; i++) {
    const up = await ping().then(
      (r) => r.ok,
      () => false,
    )
    if (up) return server
    await Bun.sleep(100)
  }
  server.kill()
  throw new Error(`orq-server did not start: ${await new Response(server.stderr).text()}`)
}
