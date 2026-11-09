// Pull requests on GitHub, read with gh. A task's PR is a link of kind gh-pr.
// orq never merges. It only reads whether you did.
import { Effect, Option, Schema } from "effect"
import { Db } from "./db.ts"
import type { Task } from "./domain.ts"
import { run } from "./proc.ts"

export const PR_LINK = "gh-pr"

const PrView = Schema.Struct({ state: Schema.String, headRefOid: Schema.String })
export type PrView = typeof PrView.Type
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(PrView))

/** The PR's state and head commit, or null when gh is missing, offline, or does not know the PR. */
export const viewPr = (repo: string, ref: string) =>
  run("gh", ["pr", "view", ref, "--json", "state,headRefOid"], repo).pipe(
    Effect.map((o) => (o.code === 0 ? Option.getOrNull(parse(o.stdout)) : null)),
    Effect.orElseSucceed(() => null),
  )

/** The task's PR: the ref of its last gh-pr link. */
export const prOf = (id: string) =>
  Effect.gen(function* () {
    const links = yield* (yield* Db).links(id)
    return links.filter((l) => l.kind === PR_LINK).at(-1)?.ref
  })

const FINISHED = new Set(["MERGED", "DROPPED"])

/** Moves each task whose PR is merged to MERGED. Asks gh only about unfinished tasks that have a PR. */
export const syncMerged = (tasks: ReadonlyArray<Task>) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* Effect.forEach(
      tasks.filter((t) => !FINISHED.has(t.status)),
      (t) =>
        Effect.gen(function* () {
          const ref = yield* prOf(t.id)
          if (!ref) return
          const pr = yield* viewPr(t.repo, ref)
          if (pr?.state === "MERGED") yield* db.setState(t.id, "ship", "MERGED", `PR ${ref} merged`)
        }),
      { concurrency: 4, discard: true },
    )
  })
