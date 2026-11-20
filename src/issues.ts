// `orq issues`: a new GitHub issue of yours → a new task. On the sessions' machine, outside the
// sandbox, no LLM. Every minute it lists your open issues in each repo of [github] repos (with
// gh), starts a task for each one no task came from yet (`orq new` in that repo's checkout,
// source github, the issue linked as its origin), and comments on the issue with the task's id.
// The issue's text is the request. Only issues you opened count: the repo may be public.
import { Config, Console, Duration, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { Db } from "./db.ts"
import { OrqError } from "./domain.ts"
import { run } from "./proc.ts"
import { withState } from "./state.ts"
import { startTask } from "./task.ts"

/** The link kind of a task's GitHub issue; its ref is the issue's URL. */
export const ISSUE_LINK = "gh-issue"

const settings = Config.all({
  /** your GitHub login: issues by anyone else are never read */
  user: Config.String("ORQ_GITHUB_USER"),
  /** each repo and its checkout: saculo/app=/home/orq/Projects/app,… */
  repos: Config.String("ORQ_GITHUB_REPOS"),
  /** seconds between two looks at GitHub */
  every: Config.Number("ORQ_GITHUB_EVERY").pipe(Config.withDefault(60)),
})

const parseRepos = (spec: string) =>
  spec
    .split(",")
    .map((pair) => pair.trim().split("=", 2) as [string, string])
    .filter(([repo, checkout]) => repo && checkout)

const Issue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  author: Schema.Struct({ login: Schema.String }),
})
type Issue = typeof Issue.Type
const decodeIssues = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Issue)))

/** `gh …`; a non-zero exit fails with gh's message. */
const gh = (args: ReadonlyArray<string>) =>
  run("gh", args).pipe(
    Effect.flatMap((out) =>
      out.code === 0
        ? Effect.succeed(out.stdout)
        : Effect.fail(new OrqError({ message: `gh ${args.slice(0, 2).join(" ")}: ${out.stderr.trim()}` })),
    ),
  )

/** Your open issues in `repo`, oldest first. */
const openIssues = (repo: string, user: string) =>
  gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--author",
    user,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,body,url,author",
  ]).pipe(
    Effect.flatMap(decodeIssues),
    Effect.mapError((e) => (e instanceof OrqError ? e : new OrqError({ message: `gh issue list: ${e.message}` }))),
    Effect.map((issues) => issues.filter((issue) => issue.author.login === user).toSorted((a, b) => a.number - b.number)),
  )

/** What the task is asked to do: the issue as you wrote it, and where it came from. */
const requestOf = (issue: Issue) => `${issue.title}\n\n${issue.body.trim()}\n\nFrom GitHub issue ${issue.url}`.replace(/\n{3,}/g, "\n\n")

/** A task for the issue, and a comment on the issue that says so. */
const startFromIssue = (repo: string, checkout: string, issue: Issue) =>
  Effect.gen(function* () {
    const { task } = yield* startTask(checkout, requestOf(issue), {
      title: issue.title,
      source: "github",
      origin: { kind: ISSUE_LINK, ref: issue.url },
    })
    yield* gh([
      "issue",
      "comment",
      String(issue.number),
      "--repo",
      repo,
      "--body",
      `orq: **${task.id}** created (${task.status}), branch \`${task.branch}\`.`,
    ])
    yield* Console.log(`orq issues: ${repo}#${issue.number} → ${task.id}`)
  })

/** One look at every repo: a task for each of your open issues that has none. A failure is
 * printed and tried again at the next look. */
const look = (repos: ReadonlyArray<readonly [string, string]>, user: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    for (const [repo, checkout] of repos) {
      const issues = yield* openIssues(repo, user).pipe(
        Effect.catch((e) => Console.error(`orq issues: ${repo}: ${e.message}`).pipe(Effect.as([] as ReadonlyArray<Issue>))),
      )
      for (const issue of issues) {
        if ((yield* db.findLink(ISSUE_LINK, issue.url)) !== null) continue
        yield* startFromIssue(repo, checkout, issue).pipe(
          Effect.catch((e) => Console.error(`orq issues: ${repo}#${issue.number}: ${e.message}`)),
        )
      }
    }
  })

const issues = Command.make("issues", {}, () =>
  Effect.gen(function* () {
    const { user, repos: spec, every } = yield* settings
    const repos = parseRepos(spec)
    yield* Console.log(`orq issues: every ${every}s, issues by ${user} in ${repos.map(([repo]) => repo).join(", ")}`)
    return yield* look(repos, user).pipe(
      Effect.catch((e) => Console.error(`orq issues: ${e.message}`)),
      Effect.andThen(Effect.sleep(Duration.seconds(every))),
      Effect.forever,
    )
  }),
).pipe(Command.withDescription("a task for each new GitHub issue of yours ([github] in the settings file)"), withState)

export { issues }
