// Pull requests on GitHub, read with gh. A task's PR is the one of its branch: orq finds it
// with gh and records it as the task's gh-pr link (the dashboard shows that link).
// orq never merges. It only reads whether you did.
import { Effect, Option, Schema } from "effect"
import { Db } from "./db.ts"
import type { Task } from "./domain.ts"
import { run } from "./proc.ts"

export const PR_LINK = "gh-pr"

const PrView = Schema.Struct({ url: Schema.String, state: Schema.String, headRefOid: Schema.String })
export type PrView = typeof PrView.Type
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(PrView))

/** The PR of `ref` (a URL, a number or a branch): its URL, state and head commit; null when gh
 * is missing, offline, or knows no such PR. */
export const viewPr = (repo: string, ref: string) =>
  run("gh", ["pr", "view", ref, "--json", "url,state,headRefOid"], repo).pipe(
    Effect.map((o) => (o.code === 0 ? Option.getOrNull(parse(o.stdout)) : null)),
    Effect.orElseSucceed(() => null),
  )

/** The task's PR: the one its gh-pr link names, or else the one of its branch, which is then
 * recorded as its gh-pr link. Null when it has none yet. */
export const prOf = (task: Task) =>
  Effect.gen(function* () {
    const db = yield* Db
    const linked = (yield* db.links(task.id)).filter((l) => l.kind === PR_LINK).at(-1)?.ref
    const pr = yield* viewPr(task.repo, linked ?? task.branch)
    if (pr && !linked) yield* db.link(task.id, PR_LINK, pr.url, "related")
    return pr
  })

const FINISHED = new Set(["MERGED", "DROPPED"])

/** Moves each task whose PR is merged to MERGED. Asks gh only about unfinished tasks in ship,
 * the step that opens the PR. */
export const syncMerged = (tasks: ReadonlyArray<Task>) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* Effect.forEach(
      tasks.filter((t) => t.step === "ship" && !FINISHED.has(t.status)),
      (t) =>
        Effect.gen(function* () {
          const pr = yield* prOf(t)
          if (pr?.state === "MERGED") yield* db.setState(t.id, "ship", "MERGED", `PR ${pr.url} merged`)
        }),
      { concurrency: 4, discard: true },
    )
  })
