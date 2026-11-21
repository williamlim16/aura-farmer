"use client";

import { Fragment, useMemo, useState } from "react";
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
  MapPin,
  Search,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
  company: string | null;
  location: string | null;
  snippet: string | null;
  postedAt: number | null;
  postedLabel: string;
  foundAt: number;
  foundLabel: string;
  foundTitle: string;
}

type SortKey = "title" | "company" | "posted" | "found";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;
const ALL = "all";

const compare: Record<SortKey, (a: JobRow, b: JobRow) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  company: (a, b) => (a.company ?? "").localeCompare(b.company ?? ""),
  // Undated (Indeed) jobs sort as oldest.
  posted: (a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0),
  found: (a, b) => a.foundAt - b.foundAt,
};

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>(ALL);
  const [keyword, setKeyword] = useState<string>(ALL);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "found",
    dir: "desc",
  });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const sources = useMemo(
    () =>
      countBy(
        rows,
        (r) => r.source,
        (r) => r.sourceLabel,
      ),
    [rows],
  );
  const keywords = useMemo(
    () =>
      countBy(
        rows,
        (r) => r.keyword,
        (r) => r.keyword,
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (source === ALL || r.source === source) &&
        (keyword === ALL || r.keyword === keyword) &&
        (!q ||
          [r.title, r.company, r.location, r.snippet].some((f) =>
            f?.toLowerCase().includes(q),
          )),
    );
    const sign = sort.dir === "asc" ? 1 : -1;
    // Stable tie-break on "found" so equal keys keep newest first.
    return list.sort(
      (a, b) => sign * compare[sort.key](a, b) || compare.found(b, a),
    );
  }, [rows, query, source, keyword, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(
    current * PAGE_SIZE,
    (current + 1) * PAGE_SIZE,
  );

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
        : { key, dir: key === "title" || key === "company" ? "asc" : "desc" },
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

  if (rows.length === 0) {
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
      <div className="glass-surface flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => resetPage(setQuery)(e.target.value)}
            placeholder="Search title, company, location…"
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
            count={rows.length}
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
      </div>

      {/* Table */}
      <div className="glass-surface overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border/70 text-muted-foreground border-b text-left text-[11px] tracking-wider uppercase">
                <SortHeader
                  label="Role"
                  sortKey="title"
                  sort={sort}
                  onSort={toggleSort}
                  className="pl-5"
                />
                <SortHeader
                  label="Company"
                  sortKey="company"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden lg:table-cell"
                />
                <th
                  scope="col"
                  className="hidden px-3 py-3 font-mono font-medium sm:table-cell"
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
                  className="hidden md:table-cell"
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
                    colSpan={6}
                    className="text-muted-foreground px-5 py-12 text-center text-sm"
                  >
                    No jobs match these filters.
                  </td>
                </tr>
              ) : (
                visible.map((job) => {
                  const open = expanded.has(job.id);
                  const detailsId = `job-${job.id}-details`;
                  return (
                    <Fragment key={job.id}>
                      <tr
                        className={cn(
                          "group border-border/50 hover:bg-muted/40 border-b align-top transition-colors",
                          open && "bg-muted/30 border-b-0",
                        )}
                      >
                        {/* Role */}
                        <td className="min-w-56 py-4 pr-3 pl-5">
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
                            <span className="sm:hidden">{job.sourceLabel}</span>
                            <span className="font-mono md:hidden">
                              {job.postedLabel}
                            </span>
                          </div>
                          <Badge
                            variant={
                              job.keywordTracked ? "outline" : "secondary"
                            }
                            className={cn(
                              "mt-2 max-w-full truncate text-[11px]",
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
                        </td>

                        {/* Company */}
                        <td className="text-foreground/90 hidden w-[22%] px-3 py-4 lg:table-cell">
                          <span className="line-clamp-2">
                            {job.company ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </td>

                        {/* Board */}
                        <td className="hidden px-3 py-4 sm:table-cell">
                          <Badge variant="teal">{job.sourceLabel}</Badge>
                        </td>

                        {/* Posted */}
                        <td className="text-muted-foreground hidden px-3 py-4 font-mono text-xs whitespace-nowrap md:table-cell">
                          {job.postedLabel}
                        </td>

                        {/* Found */}
                        <td
                          className="text-muted-foreground hidden px-3 py-4 font-mono text-xs whitespace-nowrap md:table-cell"
                          title={`Last found ${job.foundTitle}`}
                        >
                          {job.foundLabel}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 pr-5 pl-2">
                          <div className="flex items-center justify-end gap-1">
                            {job.snippet && (
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

                      {open && job.snippet && (
                        <tr
                          id={detailsId}
                          className="border-border/50 bg-muted/30 border-b"
                        >
                          <td colSpan={6} className="px-5 pt-0 pb-5">
                            <p className="border-aura-primary/40 text-muted-foreground max-w-3xl border-l-2 pl-3 text-xs leading-relaxed">
                              {job.snippet}
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
            {filtered.length !== rows.length &&
              ` (filtered from ${rows.length})`}
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
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
