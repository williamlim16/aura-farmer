import Link from "next/link";

import { Badge } from "~/components/apply/badge";
import { JobImport } from "~/components/apply/job-import";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { MatchResult } from "~/lib/match/match";
import { requireUser } from "~/server/api/session";

export const dynamic = "force-dynamic";

const BAND = { strong: ["Strong match", "success"], good: ["Good match", "success"], partial: ["Partial match", "warning"], weak: ["Weak match", "danger"] } as const;

export default async function JobsPage() {
  const { userId, deps } = await requireUser();
  const postings = await deps.repos.postings.list(userId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <p className="text-muted-foreground text-sm">Save jobs you are interested in, see how your profile matches, and prepare tailored applications.</p>
      </div>
      <JobImport />
      <Card>
        <CardHeader><CardTitle>Saved jobs</CardTitle></CardHeader>
        <CardContent>
          {postings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No saved jobs yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {postings.map((p) => {
                const m = p.match as MatchResult | null;
                return (
                  <li key={p.id}>
                    <Link href={`/apply/jobs/${p.id}`} className="hover:bg-muted/50 flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="font-medium">{p.title}</span>
                      <span className="text-muted-foreground text-sm">{p.company}{p.location ? ` · ${p.location}` : ""}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <Badge>{p.source === "manual" ? "pasted" : p.source}</Badge>
                        {m && <Badge tone={BAND[m.band][1]}>{`${BAND[m.band][0]} · ${m.score.toFixed(1)}`}</Badge>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
