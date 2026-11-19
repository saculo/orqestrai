import { useCallback } from "react"
import { usePolling } from "../hooks.ts"
import { fetchTaskEvents, type TaskEvent } from "../serverApi.ts"
import { timeAgo } from "../tasks.ts"

/** The whole messages are shown above the timeline, not in it. */
const isShownInTimeline = (event: TaskEvent) => event.kind !== "message"

/** What happened to the task, newest first. */
export const Timeline = ({ taskId, now }: { taskId: string; now: number }) => {
  const loadEvents = useCallback(() => fetchTaskEvents(taskId), [taskId])
  const events = usePolling(loadEvents, [])
  return (
    <section className="timeline" aria-label="Timeline">
      <h3 className="label">Timeline</h3>
      {events.value.filter(isShownInTimeline).map((event) => (
        <div key={`${event.at}|${event.kind}|${event.detail}`} className="ev">
          <span className="muted">{timeAgo(event.at, now)}</span>
          <span>
            {event.kind}
            {event.detail ? ` · ${event.detail}` : ""}
          </span>
        </div>
      ))}
      {events.updatedAt === null && <p className="empty">loading</p>}
    </section>
  )
}
