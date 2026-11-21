"use client";

import {
  Fragment,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  MapPin,
  Search,
} from "lucide-react";

import {
  setJobsTrackedAction,
  setJobTrackingStatusAction,
} from "~/app/jobs/actions";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DEFAULT_TRACKING_STATUS,
  isTrackingStatus,
  TRACKING_STATUSES,
  TRACKING_STATUS_META,
  type TrackingStatus,
} from "~/lib/tracking-status";
import { cn } from "~/lib/utils";

/** A job row, pre-formatted on the server so labels hydrate identically. */
export interface JobRow {
  id: number;
  title: string;
  url: string;
  source: string;
  sourceLabel: string;
  keyword: string;
  /** False if the user has since stopped tracking this keyword. */
  keywordTracked: boolean;
  /** True if the user has added this job to their /tracking shortlist. */
  tracked: boolean;
  /** Pipeline stage for tracked jobs; null when not tracked. */
  trackingStatus: TrackingStatus | null;
  company: string | null;
  location: string | null;
  snippet: string | null;
  /** Full description from the posting page; null until fetched. */
  description: string | null;
  postedAt: number | null;
  postedLabel: string;
  foundAt: number;
  foundLabel: string;
  foundTitle: string;
}

type SortKey = "title" | "company" | "status" | "posted" | "found";
type SortDir = "asc" | "desc";

type OptimisticUpdate =
  | { type: "track"; jobIds: Set<number>; tracked: boolean }
  | { type: "status"; jobIds: Set<number>; status: TrackingStatus };

const PAGE_SIZE = 20;
const ALL = "all";

const compare: Record<SortKey, (a: JobRow, b: JobRow) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  company: (a, b) => (a.company ?? "").localeCompare(b.company ?? ""),
  status: (a, b) =>
    (a.trackingStatus ? TRACKING_STATUS_META[a.trackingStatus].order : 99) -
    (b.trackingStatus ? TRACKING_STATUS_META[b.trackingStatus].order : 99),
  // Undated (Indeed) jobs sort as oldest.
  posted: (a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0),
  found: (a, b) => a.foundAt - b.foundAt,
};

export function JobsTable({
  rows,
  mode = "all",
}: {
  rows: JobRow[];
  mode?: "all" | "tracking";
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>(ALL);
  const [keyword, setKeyword] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "found",
    dir: "desc",
  });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [optimisticRows, applyOptimistic] = useOptimistic(
    rows,
    (state: JobRow[], update: OptimisticUpdate) =>
      state.map((r) => {
        if (!update.jobIds.has(r.id)) return r;
        if (update.type === "track") {
          return {
            ...r,
            tracked: update.tracked,
            trackingStatus: update.tracked
              ? (r.trackingStatus ?? DEFAULT_TRACKING_STATUS)
              : null,
          };
        }
        return {
          ...r,
          tracked: true,
          trackingStatus: update.status,
        };
      }),
  );

  const effectiveRows = useMemo(
    () =>
      mode === "tracking"
        ? optimisticRows.filter((r) => r.tracked)
        : optimisticRows,
    [mode, optimisticRows],
  );

  const trackedCount = useMemo(
    () => optimisticRows.filter((r) => r.tracked).length,
    [optimisticRows],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<TrackingStatus, number>();
    for (const s of TRACKING_STATUSES) counts.set(s, 0);
    for (const r of effectiveRows) {
      if (r.trackingStatus) {
        counts.set(r.trackingStatus, (counts.get(r.trackingStatus) ?? 0) + 1);
      }
    }
    return counts;
  }, [effectiveRows]);

  const sources = useMemo(
    () =>
      countBy(
        effectiveRows,
        (r) => r.source,
        (r) => r.sourceLabel,
      ),
    [effectiveRows],
  );
  const keywords = useMemo(
    () =>
      countBy(
        effectiveRows,
        (r) => r.keyword,
        (r) => r.keyword,
      ),
    [effectiveRows],
  );

  const activeStatusFilter =
    mode === "all" && trackedCount === 0 ? ALL : statusFilter;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = effectiveRows.filter(
      (r) =>
        (source === ALL || r.source === source) &&
        (keyword === ALL || r.keyword === keyword) &&
        (activeStatusFilter === ALL ||
          r.trackingStatus === activeStatusFilter) &&
        (!q ||
          [r.title, r.company, r.location, r.snippet, r.description].some((f) =>
            f?.toLowerCase().includes(q),
          )),
    );
    const sign = sort.dir === "asc" ? 1 : -1;
    // Stable tie-break on "found" so equal keys keep newest first.
    return list.sort(
      (a, b) => sign * compare[sort.key](a, b) || compare.found(b, a),
    );
  }, [effectiveRows, query, source, keyword, activeStatusFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(
    current * PAGE_SIZE,
    (current + 1) * PAGE_SIZE,
  );

  const allVisibleTracked =
    visible.length > 0 && visible.every((r) => r.tracked);
  const someVisibleTracked = visible.some((r) => r.tracked);

  function toggleTracked(jobIds: number[], tracked: boolean) {
    if (jobIds.length === 0) return;
    setActionError(null);
    startTransition(async () => {
      applyOptimistic({ type: "track", jobIds: new Set(jobIds), tracked });
      const result = await setJobsTrackedAction({ jobIds, tracked });
      if (!result.ok) {
        setActionError(result.message);
      }
    });
  }

  function changeStatus(jobIds: number[], status: TrackingStatus) {
    if (jobIds.length === 0) return;
    setActionError(null);
    startTransition(async () => {
      applyOptimistic({ type: "status", jobIds: new Set(jobIds), status });
      const result = await setJobTrackingStatusAction({ jobIds, status });
      if (!result.ok) {
        setActionError(result.message);
      }
    });
  }

  function handleToggleVisible() {
    if (visible.length === 0) return;
    if (allVisibleTracked) {
      toggleTracked(
        visible.map((r) => r.id),
        false,
      );
    } else {
      toggleTracked(
        visible.filter((r) => !r.tracked).map((r) => r.id),
        true,
      );
    }
  }

  function resetPage<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(0);
    };
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir:
              key === "title" || key === "company" || key === "status"
                ? "asc"
                : "desc",
          },
    );
    setPage(0);
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (effectiveRows.length === 0) {
    if (mode === "tracking") {
      return (
        <div className="border-border bg-background/45 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <span className="border-aura-primary/25 bg-primary/10 text-aura-primary inline-flex size-10 items-center justify-center rounded-xl border">
            <ListChecks aria-hidden="true" className="size-5" />
          </span>
          <p className="font-heading text-foreground text-base font-medium">
            No tracked jobs yet
          </p>
          <p className="text-muted-foreground max-w-md text-sm">
            Use the checkboxes in All jobs to curate your shortlist of roles for
            tailoring your CV and resume.
          </p>
          <Link
            href="/jobs/all"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Browse all jobs
          </Link>
        </div>
      );
    }

    return (
      <div className="border-border bg-background/45 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
        <span className="border-aura-primary/25 bg-primary/10 text-aura-primary inline-flex size-10 items-center justify-center rounded-xl border">
          <Briefcase aria-hidden="true" className="size-5" />
        </span>
        <p className="font-heading text-foreground text-base font-medium">
          No jobs yet
        </p>
        <p className="text-muted-foreground max-w-md text-sm">
          Add job titles in the Feed tab and hit “Find jobs” — everything we
          find will be collected here.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* Toolbar */}
      <div className="glass-surface flex flex-col gap-3 rounded-2xl p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => resetPage(setQuery)(e.target.value)}
            placeholder="Search title, company, description…"
            aria-label="Search jobs"
            className="pl-9"
          />
        </div>

        <div
          role="group"
          aria-label="Filter by job board"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterChip
            active={source === ALL}
            onClick={() => resetPage(setSource)(ALL)}
            label="All boards"
            count={effectiveRows.length}
          />
          {sources.map((s) => (
            <FilterChip
              key={s.value}
              active={source === s.value}
              onClick={() => resetPage(setSource)(s.value)}
              label={s.label}
              count={s.count}
            />
          ))}
        </div>

        {keywords.length > 1 && (
          <select
            value={keyword}
            onChange={(e) => resetPage(setKeyword)(e.target.value)}
            aria-label="Filter by job title"
            className="border-input bg-background/70 text-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-background/50 h-10 cursor-pointer rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
          >
            <option value={ALL}>All job titles</option>
            {keywords.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} ({k.count})
              </option>
            ))}
          </select>
        )}

        {mode === "all" && trackedCount > 0 && (
          <select
            value={activeStatusFilter}
            onChange={(e) => resetPage(setStatusFilter)(e.target.value)}
            aria-label="Filter by tracking status"
            className="border-input bg-background/70 text-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-background/50 h-10 cursor-pointer rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
          >
            <option value={ALL}>All statuses</option>
            {TRACKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRACKING_STATUS_META[s].label} ({statusCounts.get(s) ?? 0})
              </option>
            ))}
          </select>
        )}

        {mode === "all" && (
          <Link
            href="/jobs/tracking"
            className={cn(
              "focus-visible:ring-ring inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none",
              trackedCount > 0
                ? "border-aura-primary/35 bg-primary/12 text-aura-primary hover:bg-primary/20"
                : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <ListChecks aria-hidden="true" className="size-3.5" />
            <span>Tracked</span>
            <span className="font-mono text-[11px] opacity-80">
              ({trackedCount})
            </span>
          </Link>
        )}
      </div>

      {/* Pipeline status bar on Tracking view */}
      {mode === "tracking" && (
        <div
          role="group"
          aria-label="Filter by tracking status"
          className="glass-surface flex flex-wrap items-center gap-1.5 rounded-2xl px-4 py-3"
        >
          <FilterChip
            active={statusFilter === ALL}
            onClick={() => resetPage(setStatusFilter)(ALL)}
            label="All statuses"
            count={effectiveRows.length}
          />
          {TRACKING_STATUSES.map((s) => {
            const meta = TRACKING_STATUS_META[s];
            return (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => resetPage(setStatusFilter)(s)}
                label={meta.label}
                count={statusCounts.get(s) ?? 0}
                dotClass={meta.dotClass}
              />
            );
          })}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="border-destructive/30 bg-destructive/12 text-destructive rounded-xl border px-4 py-2.5 text-xs font-medium"
        >
          {actionError}
        </div>
      )}

      {/* Table */}
      <div
        className="glass-surface overflow-hidden rounded-2xl"
        aria-busy={isPending}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border/70 text-muted-foreground border-b text-left text-[11px] tracking-wider uppercase">
                <th scope="col" className="w-10 py-3 pr-2 pl-5">
                  <input
                    type="checkbox"
                    checked={allVisibleTracked}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          someVisibleTracked && !allVisibleTracked;
                      }
                    }}
                    disabled={visible.length === 0}
                    onChange={handleToggleVisible}
                    aria-label={
                      allVisibleTracked
                        ? "Remove visible jobs from tracking"
                        : "Add visible jobs to tracking"
                    }
                    className="accent-primary focus-visible:ring-ring size-4 cursor-pointer rounded align-middle focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </th>
                <SortHeader
                  label="Role"
                  sortKey="title"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortHeader
                  label="Company"
                  sortKey="company"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden lg:table-cell"
                />
                <SortHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden sm:table-cell"
                />
                <th
                  scope="col"
                  className="hidden px-3 py-3 font-mono font-medium xl:table-cell"
                >
                  Description
                </th>
                <th
                  scope="col"
                  className="hidden px-3 py-3 font-mono font-medium md:table-cell"
                >
                  Board
                </th>
                <SortHeader
                  label="Posted"
                  sortKey="posted"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden md:table-cell"
                />
                <SortHeader
                  label="Found"
                  sortKey="found"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden lg:table-cell"
                />
                <th scope="col" className="py-3 pr-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-muted-foreground px-5 py-12 text-center text-sm"
                  >
                    No jobs match these filters.
                  </td>
                </tr>
              ) : (
                visible.map((job) => {
                  const open = expanded.has(job.id);
                  const details = job.description ?? job.snippet;
                  const detailsId = `job-${job.id}-details`;
                  return (
                    <Fragment key={job.id}>
                      <tr
                        className={cn(
                          "group border-border/50 hover:bg-muted/40 border-b align-top transition-colors",
                          open && "bg-muted/30 border-b-0",
                        )}
                      >
                        {/* Track checkbox */}
                        <td className="w-10 py-4 pr-2 pl-5 align-top">
                          <input
                            type="checkbox"
                            checked={job.tracked}
                            onChange={() =>
                              toggleTracked([job.id], !job.tracked)
                            }
                            aria-label={
                              job.tracked
                                ? `Remove ${job.title} from tracking`
                                : `Add ${job.title} to tracking`
                            }
                            className="accent-primary focus-visible:ring-ring mt-1 size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
                          />
                        </td>

                        {/* Role */}
                        <td className="min-w-60 px-3 py-4">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-heading text-foreground hover:text-aura-primary line-clamp-2 text-[15px] leading-snug font-medium underline-offset-4 hover:underline"
                          >
                            {job.title}
                          </a>
                          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {job.company && (
                              <span className="inline-flex min-w-0 items-center gap-1 lg:hidden">
                                <Building2
                                  aria-hidden="true"
                                  className="size-3 shrink-0"
                                />
                                <span className="truncate">{job.company}</span>
                              </span>
                            )}
                            {job.location && (
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <MapPin
                                  aria-hidden="true"
                                  className="size-3 shrink-0"
                                />
                                <span className="truncate">{job.location}</span>
                              </span>
                            )}
                            {/* Board + date collapse into the role cell on small screens */}
                            <span className="md:hidden">{job.sourceLabel}</span>
                            <span className="font-mono md:hidden">
                              {job.postedLabel}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={
                                job.keywordTracked ? "outline" : "secondary"
                              }
                              className={cn(
                                "max-w-full truncate text-[11px]",
                                !job.keywordTracked && "opacity-60",
                              )}
                              title={
                                job.keywordTracked
                                  ? `Found searching "${job.keyword}"`
                                  : `Found searching "${job.keyword}" (no longer tracked)`
                              }
                            >
                              {job.keyword}
                            </Badge>
                            <div className="sm:hidden">
                              <StatusSelect
                                status={job.trackingStatus}
                                jobTitle={job.title}
                                onChange={(status) =>
                                  changeStatus([job.id], status)
                                }
                              />
                            </div>
                          </div>
                        </td>

                        {/* Company */}
                        <td className="text-foreground/90 hidden w-[15%] px-3 py-4 lg:table-cell">
                          <span className="line-clamp-2">
                            {job.company ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="hidden px-3 py-4 whitespace-nowrap sm:table-cell">
                          <StatusSelect
                            status={job.trackingStatus}
                            jobTitle={job.title}
                            onChange={(status) =>
                              changeStatus([job.id], status)
                            }
                          />
                        </td>

                        {/* Description */}
                        <td className="hidden w-[32%] min-w-64 px-3 py-4 xl:table-cell">
                          {job.description ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(job.id)}
                              aria-expanded={open}
                              aria-controls={detailsId}
                              title={
                                open
                                  ? "Hide description"
                                  : "Show full description"
                              }
                              className="text-muted-foreground hover:text-foreground line-clamp-3 cursor-pointer text-left text-xs leading-relaxed transition-colors"
                            >
                              {job.description}
                            </button>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </td>

                        {/* Board */}
                        <td className="hidden px-3 py-4 whitespace-nowrap md:table-cell">
                          <Badge variant="teal">{job.sourceLabel}</Badge>
                        </td>

                        {/* Posted */}
                        <td className="text-muted-foreground hidden px-3 py-4 font-mono text-xs whitespace-nowrap md:table-cell">
                          {job.postedLabel}
                        </td>

                        {/* Found */}
                        <td
                          className="text-muted-foreground hidden px-3 py-4 font-mono text-xs whitespace-nowrap lg:table-cell"
                          title={`Last found ${job.foundTitle}`}
                        >
                          {job.foundLabel}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 pr-5 pl-2">
                          <div className="flex items-center justify-end gap-1">
                            {details && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => toggleExpanded(job.id)}
                                aria-expanded={open}
                                aria-controls={detailsId}
                                aria-label={
                                  open ? "Hide details" : "Show details"
                                }
                              >
                                <ChevronDown
                                  aria-hidden="true"
                                  className={cn(
                                    "size-4 transition-transform",
                                    open && "rotate-180",
                                  )}
                                />
                              </Button>
                            )}
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${job.title} on ${job.sourceLabel}`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "icon-sm",
                              })}
                            >
                              <ExternalLink
                                aria-hidden="true"
                                className="size-3.5"
                              />
                            </a>
                          </div>
                        </td>
                      </tr>

                      {open && details && (
                        <tr
                          id={detailsId}
                          className="border-border/50 bg-muted/30 border-b"
                        >
                          <td colSpan={9} className="px-5 pt-0 pb-5">
                            <p className="border-aura-primary/40 text-muted-foreground max-w-5xl border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-line">
                              {details}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        <div className="border-border/70 flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-muted-foreground font-mono text-xs">
            {filtered.length === 0
              ? "0 jobs"
              : `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            {filtered.length !== effectiveRows.length &&
              ` (filtered from ${effectiveRows.length})`}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
                aria-label="Previous page"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="text-muted-foreground px-1 font-mono text-xs">
                {current + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusSelect({
  status,
  jobTitle,
  onChange,
}: {
  status: TrackingStatus | null;
  jobTitle: string;
  onChange: (status: TrackingStatus) => void;
}) {
  return (
    <div className="relative inline-flex items-center">
      {status && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-2.5 size-1.5 rounded-full",
            TRACKING_STATUS_META[status].dotClass,
          )}
        />
      )}
      <select
        value={status ?? ""}
        onChange={(e) => {
          if (isTrackingStatus(e.target.value)) {
            onChange(e.target.value);
          }
        }}
        aria-label={`Tracking status for ${jobTitle}`}
        className={cn(
          "focus-visible:ring-ring h-7 cursor-pointer appearance-none rounded-full border pr-6 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
          status
            ? cn("pl-5", TRACKING_STATUS_META[status].badgeClass)
            : "border-border/80 bg-background/60 text-muted-foreground hover:border-foreground/25 hover:text-foreground pl-2.5",
        )}
      >
        {!status && (
          <option value="" disabled>
            Untracked
          </option>
        )}
        {TRACKING_STATUSES.map((s) => (
          <option
            key={s}
            value={s}
            className="bg-popover text-popover-foreground"
          >
            {TRACKING_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 size-3 opacity-70"
      />
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn("px-3 py-3 font-mono font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "hover:text-foreground inline-flex cursor-pointer items-center gap-1 uppercase transition-colors",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn("size-3", !active && "opacity-50")}
        />
      </button>
    </th>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  dotClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-aura-primary/35 bg-primary/12 text-aura-primary"
          : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {dotClass && (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", dotClass)}
        />
      )}
      {label}
      <span className="font-mono text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function countBy(
  rows: JobRow[],
  key: (r: JobRow) => string,
  label: (r: JobRow) => string,
) {
  const map = new Map<
    string,
    { value: string; label: string; count: number }
  >();
  for (const r of rows) {
    const k = key(r);
    const entry = map.get(k) ?? { value: k, label: label(r), count: 0 };
    entry.count++;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
