// The trigger endpoint: one route, POST /github/issues, served only on --trigger-port. A GitHub
// Action posts an issue there with the bearer token (ORQ_TRIGGER_TOKEN); the server adds one
// backlog task per issue. It only touches the database; it never runs a command.
import { createHash, timingSafeEqual } from "node:crypto"
import { Db } from "@orqestrai/core/db.ts"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { addIssue, Starts } from "./starts.ts"

const Body = Schema.Struct({
  repo: Schema.String,
  issue: Schema.Struct({ url: Schema.String, number: Schema.Number, title: Schema.String }),
  request: Schema.String,
})
const decodeBody = Schema.decodeUnknownEffect(Body)

const digest = (s: string) => createHash("sha256").update(s).digest()
const bearer = (token: string) => (header: string | undefined) => {
  const given = header?.match(/^Bearer (.*)$/)?.[1] ?? ""
  return timingSafeEqual(digest(given), digest(token)) && given.length > 0
}

export const trigger = (token: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const db = yield* Db
      const add = addIssue(db, yield* Starts)
      const allowed = bearer(token)
      return HttpRouter.add(
        "POST",
        "/github/issues",
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          if (!allowed(req.headers.authorization)) return HttpServerResponse.text("unauthorized", { status: 401 })
          const body = yield* req.json.pipe(
            Effect.flatMap(decodeBody),
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (body === undefined) return HttpServerResponse.text("bad request", { status: 400 })
          const { repo, issue, request } = body
          const done = yield* add({ repo, url: issue.url, title: issue.title, request })
          return yield* HttpServerResponse.json(done)
        }).pipe(Effect.catch((e) => Effect.succeed(HttpServerResponse.text(e.message, { status: 500 })))),
      )
    }),
  )
