import { invariant } from "./errors";
const transitions: Record<string, Record<string, string>> = {
  approve: { DRAFT: "APPROVED" },
  schedule: { APPROVED: "SCHEDULED" },
  cancel: {
    DRAFT: "CANCELLED",
    APPROVED: "CANCELLED",
    SCHEDULED: "CANCELLED",
    CLAIMED: "CANCELLED",
    AWAITING_MANUAL: "CANCELLED",
    BLOCKED: "CANCELLED",
  },
  mark_manual_published: { AWAITING_MANUAL: "PUBLISHED" },
};
export function publicationTransition(status: string, action: string) {
  const next = transitions[action]?.[status];
  invariant(next);
  return next;
}
export function dueStatus(at: Date, now: Date, mode: string, lateness: number) {
  if (at > now) return null;
  if (now.getTime() - at.getTime() > lateness * 1000) return "EXPIRED";
  return mode === "MANUAL" ? "AWAITING_MANUAL" : "CLAIMED";
}
export const activeRuns = [
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "NEEDS_RECONCILIATION",
  "STOPPING",
];
