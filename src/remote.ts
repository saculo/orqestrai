// Db through `orq serve` (src/server.ts) instead of the database: the CLI uses these
// when ORQ_SERVER is set, so they need no database password. ORQ_SERVER is the server's
// Unix socket path (/run/orq/orq.sock) or its URL (http://127.0.0.1:7420).
import { Config, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { OrqApi } from "./api.ts"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"

class Client extends Context.Service<Client, HttpApiClient.ForApi<typeof OrqApi>>()("orq/Client") {}

/** A socket path goes in Bun's `unix` fetch option; the URL is then only a placeholder. */
const client = Layer.unwrap(
  Effect.gen(function* () {
    const server = yield* Config.String("ORQ_SERVER")
    const socket = server.startsWith("/")
    const http = socket
      ? FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { unix: server } as RequestInit)))
      : FetchHttpClient.layer
    return Layer.effect(
      Client,
      HttpApiClient.make(OrqApi, {
        transformClient: HttpClient.mapRequest(HttpClientRequest.prependUrl(socket ? "http://orq" : server)),
      }),
    ).pipe(Layer.provide(http))
  }),
)

/** orq's own errors pass through; a server that cannot be reached is an OrqError too. */
const call = <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>) =>
  Effect.mapError(self, (e) => (e instanceof OrqError ? e : new OrqError({ message: `orq server: ${e.message}` })))

const db = Layer.effect(
  Db,
  Effect.gen(function* () {
    const { tasks } = yield* Client
    return Db.of({
      create: (task) => call(tasks.create({ payload: task })),
      remove: (id) => call(tasks.remove({ params: { id } })),
      get: (id) => call(tasks.get({ params: { id } })),
      list: call(tasks.list()),
      setState: (id, step, status, note, message) =>
        call(tasks.setState({ params: { id }, payload: { step, status, note, ...(message === undefined ? {} : { message }) } })),
      events: (id, limit) => call(tasks.events({ params: { id }, query: { limit } })),
      link: (id, kind, ref, role) => call(tasks.link({ params: { id }, payload: { kind, ref, role } })),
      links: (id) => call(tasks.links({ params: { id } })),
      findLink: (kind, ref) => call(tasks.findLink({ query: { kind, ref } })),
      setType: (id, playbook) => call(tasks.setPlaybook({ params: { id }, payload: { playbook } })),
      now: (id) => call(tasks.now({ params: { id } })),
      fileSums: (id) => call(tasks.fileSums({ params: { id } })),
      putFiles: (id, put, keep) => call(tasks.putFiles({ params: { id }, payload: { put, keep } })),
      file: (id, path) => call(tasks.file({ params: { id }, query: { path } })),
    })
  }),
)

/** Db served by `orq serve`. */
export const Remote = db.pipe(Layer.provide(client))
