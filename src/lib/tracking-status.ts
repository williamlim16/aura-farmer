export const TRACKING_STATUSES = [
  "lead",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const DEFAULT_TRACKING_STATUS: TrackingStatus = "lead";

export const TRACKING_STATUS_META: Record<
  TrackingStatus,
  { label: string; order: number; badgeClass: string; dotClass: string }
> = {
  lead: {
    label: "Lead",
    order: 1,
    badgeClass: "border-border bg-secondary/80 text-secondary-foreground",
    dotClass: "bg-muted-foreground",
  },
  applied: {
    label: "Applied",
    order: 2,
    badgeClass: "border-aura-primary/35 bg-primary/12 text-aura-primary",
    dotClass: "bg-aura-primary",
  },
  interviewing: {
    label: "Interviewing",
    order: 3,
    badgeClass:
      "border-aura-secondary/35 bg-aura-secondary/12 text-aura-secondary",
    dotClass: "bg-aura-secondary",
  },
  offer: {
    label: "Offer",
    order: 4,
    badgeClass:
      "border-emerald-500/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
  },
  rejected: {
    label: "Rejected",
    order: 5,
    badgeClass: "border-destructive/35 bg-destructive/12 text-destructive",
    dotClass: "bg-destructive",
  },
  withdrawn: {
    label: "Withdrawn",
    order: 6,
    badgeClass: "border-border bg-card/60 text-muted-foreground",
    dotClass: "bg-muted-foreground/60",
  },
};

export function isTrackingStatus(value: unknown): value is TrackingStatus {
  return (
    typeof value === "string" &&
    (TRACKING_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeTrackingStatus(
  value: string | null | undefined,
): TrackingStatus {
  return isTrackingStatus(value) ? value : DEFAULT_TRACKING_STATUS;
}
