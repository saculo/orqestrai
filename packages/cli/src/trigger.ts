// `orq trigger github`: runs in a GitHub Actions job. An issue got a label an automation names →
// the rendered request, the repo and the issue go to orq-server's trigger port; it prints the task id.

import { readFileSync } from "node:fs"
import { OrqError } from "@orqestrai/core/domain.ts"
import { Config, Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { findAutomation, render } from "./automations.ts"
import { topLevel } from "./git.ts"

const settings = Config.all({
  event: Config.String("GITHUB_EVENT_PATH"),
  url: Config.String("ORQ_TRIGGER_URL"),
  token: Config.String("ORQ_TRIGGER_TOKEN"),
})

const Event = Schema.Struct({
  action: Schema.String,
  label: Schema.optional(Schema.Struct({ name: Schema.String })),
  issue: Schema.Struct({
    number: Schema.Number,
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    html_url: Schema.String,
  }),
  repository: Schema.Struct({ full_name: Schema.String }),
})

const post = (url: string, token: string, payload: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const r = await fetch(`${url.replace(/\/+$/, "")}/github/issues`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const text = await r.text()
      if (!r.ok) throw new OrqError({ message: `the trigger endpoint answered ${r.status}: ${text}` })
      return JSON.parse(text) as { id: string; added: boolean }
    },
    catch: (e) => (e instanceof OrqError ? e : new OrqError({ message: `${url}: ${e instanceof Error ? e.message : String(e)}` })),
  })

const github = Command.make("github", {}, () =>
  Effect.gen(function* () {
    const env = yield* settings.pipe(
      Effect.catch(() =>
        Effect.fail(new OrqError({ message: "GITHUB_EVENT_PATH, ORQ_TRIGGER_URL and ORQ_TRIGGER_TOKEN must all be set" })),
      ),
    )
    const event = yield* Effect.try({
      try: () => JSON.parse(readFileSync(env.event, "utf8")) as unknown,
      catch: (e) => new OrqError({ message: `${env.event}: ${e instanceof Error ? e.message : String(e)}` }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Event)),
      Effect.mapError((e) => (e instanceof OrqError ? e : new OrqError({ message: `${env.event} is not an issues event` }))),
    )
    const label = event.label?.name
    if (event.action !== "labeled" || label === undefined) return yield* Console.log(`not a labeled issue (${event.action}); nothing to do`)
    const automation = yield* findAutomation(yield* topLevel(), label)
    if (!automation) return yield* Console.log(`no automation matched the label "${label}"; nothing to do`)
    const { issue, repository } = event
    const request = render(automation.template, {
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
      number: String(issue.number),
      repo: repository.full_name,
    })
    const out = yield* post(env.url, env.token, {
      repo: repository.full_name,
      issue: { url: issue.html_url, number: issue.number, title: issue.title },
      request,
    })
    yield* Console.log(`${out.id} ${out.added ? "added" : "already there"}`)
  }),
).pipe(Command.withDescription("an issue was labeled: add a task for it on orq-server's trigger port (GitHub Actions)"))

export const trigger = Command.make("trigger").pipe(Command.withDescription("tasks from outside events"), Command.withSubcommands([github]))
