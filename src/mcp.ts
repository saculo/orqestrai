// orq's state as MCP tools: `orq mcp`, which Claude Code starts over stdio. The tools use the same
// Db and Slots as the CLI, so with ORQ_SERVER set they go through `orq serve` and the session never
// holds the database password (DESIGN.md, Security). They never run a command: a slot's stop
// command comes back in the result, for the session to run as its own user.
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { Db } from "./db.ts"
import { LinkRole, OrqError, Status, Step, Task, TaskEvent, TaskLink } from "./domain.ts"
import { Slot, Slots, takeSlot } from "./slots.ts"

const id = Schema.String.annotate({ description: "task id, e.g. T-0001" })

const Show = Tool.make("orq_show", {
  description: "A task: its step, status and worktree, its links, and its last 10 events (newest first).",
  parameters: Schema.Struct({ id }),
  success: Schema.Struct({ task: Task, links: Schema.Array(TaskLink), events: Schema.Array(TaskEvent) }),
  failure: OrqError,
}).annotate(Tool.Readonly, true)

const State = Tool.make("orq_state", {
  description: "Record the task's step and status, with a one-line note.",
  parameters: Schema.Struct({ id, step: Step, status: Status, note: Schema.optional(Schema.String) }),
  failure: OrqError,
})

const Link = Tool.make("orq_link", {
  description: "Link the task to an outside reference: an issue, a ticket, a thread, a PR.",
  parameters: Schema.Struct({
    id,
    kind: Schema.String.annotate({ description: "e.g. gh-issue, jira, slack-thread, gh-pr" }),
    ref: Schema.String.annotate({ description: "the reference in that system, e.g. the PR's URL" }),
    role: Schema.optional(LinkRole),
  }),
  failure: OrqError,
}).annotate(Tool.Idempotent, true)

const SlotTake = Tool.make("orq_slot_take", {
  description:
    "Take a verify slot for the task, waiting up to wait_seconds while every slot is held. " +
    "Returns the slot, its port base and compose project, and the expired slots it freed: run each one's stop command in its worktree.",
  parameters: Schema.Struct({ id, wait_seconds: Schema.optional(Schema.Int) }),
  success: Schema.Struct({ slot: Schema.Int, port_base: Schema.Int, project: Schema.String, expired: Schema.Array(Slot) }),
  failure: OrqError,
})

const SlotKeep = Tool.make("orq_slot_keep", {
  description: "Keep the task's slot after verify, with the command that stops its app and the port the user opens.",
  parameters: Schema.Struct({ id, stop: Schema.String, port: Schema.Int }),
  success: Slot,
  failure: OrqError,
})

const SlotFree = Tool.make("orq_slot_free", {
  description: "Free the task's slot. Returns the freed slot, or null; if it has a stop command, run it in its worktree.",
  parameters: Schema.Struct({ id }),
  success: Schema.NullOr(Slot),
  failure: OrqError,
})

export const OrqTools = Toolkit.make(Show, State, Link, SlotTake, SlotKeep, SlotFree)

const handlers = OrqTools.toLayer(
  Effect.gen(function* () {
    const db = yield* Db
    const slots = yield* Slots
    return {
      orq_show: ({ id }) => Effect.all({ task: db.get(id), links: db.links(id), events: db.events(id, 10) }),
      orq_state: ({ id, step, status, note }) => db.setState(id, step, status, note ?? ""),
      orq_link: ({ id, kind, ref, role }) => db.link(id, kind, ref, role ?? "related"),
      orq_slot_take: ({ id, wait_seconds }) =>
        takeSlot(id, wait_seconds ?? 0).pipe(
          Effect.map(({ slot, expired, portBase, project }) => ({ slot: slot.n, port_base: portBase, project, expired })),
          Effect.provideService(Db, db),
          Effect.provideService(Slots, slots),
        ),
      orq_slot_keep: ({ id, stop, port }) => slots.keep(id, stop, port),
      orq_slot_free: ({ id }) => slots.free(id).pipe(Effect.map((s) => s ?? null)),
    }
  }),
)

/** The tools over stdin/stdout, for Claude Code to start. */
export const mcpStdio = McpServer.toolkit(OrqTools).pipe(
  Layer.provide(handlers),
  Layer.provide(McpServer.layerStdio({ name: "orq", version: "0.1.0", protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18] })),
)
