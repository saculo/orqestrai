import type { Status } from "../serverApi.ts"

const CHIP_CLASS: Record<Status, string> = {
  "WAITING FOR ME": "s-waiting",
  BLOCKED: "s-blocked",
  "IN PROGRESS": "s-progress",
  TODO: "s-todo",
  MERGED: "s-merged",
  DROPPED: "s-dropped",
}

/** A task's status, coloured by what it means for you. */
export const StatusChip = ({ status }: { status: Status }) => <span className={`chip ${CHIP_CLASS[status]}`}>{status}</span>
