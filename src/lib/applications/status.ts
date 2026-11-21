/**
 * Application lifecycle. Pure so it can be shared by repositories, the worker,
 * API handlers and the UI.
 *
 *   draft -> queued -> running -> ready_for_review -> submitted_by_user
 *                         \-> failed -> queued (retry)
 *   draft|queued|running -> cancelled
 *
 * "submitted_by_user" is only ever set by an explicit user action after they
 * submitted the form themselves; the system never submits.
 */
export const APPLICATION_STATUSES = [
  "draft",
  "queued",
  "running",
  "ready_for_review",
  "failed",
  "cancelled",
  "submitted_by_user",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["running", "cancelled", "failed"],
  running: ["ready_for_review", "failed", "cancelled", "queued"], // queued = lease expired, retry
  ready_for_review: ["submitted_by_user", "queued"], // re-run after profile edits
  failed: ["queued", "cancelled"],
  cancelled: ["queued"],
  submitted_by_user: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const ACTIVE_STATUSES: readonly ApplicationStatus[] = ["queued", "running"];

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ApplicationStatus,
    readonly to: ApplicationStatus,
  ) {
    super(`Cannot move application from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}
