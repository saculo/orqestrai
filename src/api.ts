// The HTTP API of `orq serve`: orq's state, for clients that have no database password. Shared by
// the server (src/server.ts) and the client (src/remote.ts), so the two cannot disagree on a field.
// It mirrors the Db and Slots services one to one; a remote client is just another implementation.
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { LinkRole, NewTask, OrqError, Status, Step, Task, TaskEvent, TaskLink } from "./domain.ts"
import { Slot, Taken } from "./slots.ts"

const id = { id: Schema.String }

export class TasksApi extends HttpApiGroup.make("tasks").add(
  HttpApiEndpoint.post("create", "/tasks", { payload: NewTask, success: Task, error: OrqError }),
  HttpApiEndpoint.delete("remove", "/tasks/:id", { params: id, error: OrqError }),
  HttpApiEndpoint.get("get", "/tasks/:id", { params: id, success: Task, error: OrqError }),
  HttpApiEndpoint.get("list", "/tasks", { success: Schema.Array(Task), error: OrqError }),
  HttpApiEndpoint.post("setState", "/tasks/:id/state", {
    params: id,
    payload: Schema.Struct({ step: Step, status: Status, note: Schema.String }),
    error: OrqError,
  }),
  HttpApiEndpoint.get("events", "/tasks/:id/events", {
    params: id,
    query: { limit: Schema.NumberFromString },
    success: Schema.Array(TaskEvent),
    error: OrqError,
  }),
  HttpApiEndpoint.post("link", "/tasks/:id/links", {
    params: id,
    payload: Schema.Struct({ kind: Schema.String, ref: Schema.String, role: LinkRole }),
    error: OrqError,
  }),
  HttpApiEndpoint.get("links", "/tasks/:id/links", { params: id, success: Schema.Array(TaskLink), error: OrqError }),
) {}

export class SlotsApi extends HttpApiGroup.make("slots").add(
  HttpApiEndpoint.post("take", "/slots/:id/take", {
    params: id,
    payload: Schema.Struct({ worktree: Schema.String }),
    success: Taken,
    error: OrqError,
  }),
  HttpApiEndpoint.post("keep", "/slots/:id/keep", {
    params: id,
    payload: Schema.Struct({ stop: Schema.String, port: Schema.Int }),
    success: Slot,
    error: OrqError,
  }),
  HttpApiEndpoint.delete("free", "/slots/:id", { params: id, success: Schema.NullOr(Slot), error: OrqError }),
  HttpApiEndpoint.get("list", "/slots", { success: Schema.Array(Slot), error: OrqError }),
) {}

export class OrqApi extends HttpApi.make("orq").add(TasksApi).add(SlotsApi) {}
