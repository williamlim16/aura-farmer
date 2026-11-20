import Link from "next/link";

import { Badge } from "~/components/apply/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { statusView } from "~/lib/applications/view";
import { publicApplication } from "~/server/api/handlers";
import { requireUser } from "~/server/api/session";

export const dynamic = "force-dynamic";

export default async function ApplyDashboard() {
  const { userId, deps } = await requireUser();
  const [profile, apps] = await Promise.all([deps.repos.profiles.get(userId), deps.repos.applications.list(userId, { limit: 20 })]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your applications</h1>
        <p className="text-muted-foreground text-sm">Upload a resume, review your profile, then let the assistant fill a test application for you to check. Nothing is ever submitted for you.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Profile</CardTitle>
          <CardDescription>
            {profile ? `Last updated ${profile.updatedAt.toLocaleString()}.` : "No profile yet. Start by uploading your resume."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/apply/profile" className={buttonVariants({ variant: profile ? "outline" : "default" })}>
            {profile ? "Review profile" : "Upload resume"}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Applications</CardTitle>
          <CardDescription>{apps.length ? "Most recent first." : "No applications yet."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {profile && (
            <div>
              <Link href="/apply/new" className={buttonVariants({ variant: "default" })}>Prepare a new application</Link>
            </div>
          )}
          {apps.length > 0 && (
            <ul className="divide-y rounded-md border">
              {apps.map((a) => {
                const view = statusView(a.status);
                const p = publicApplication(a);
                return (
                  <li key={a.id}>
                    <Link href={`/apply/applications/${a.id}`} className="hover:bg-muted/50 flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="font-medium">{a.title ?? a.targetKey}</span>
                      <span className="text-muted-foreground text-sm">{a.company}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {p.summary && <span className="text-muted-foreground text-xs">{p.summary.verified} filled · {p.summary.needsHuman} need you</span>}
                        <Badge tone={view.tone}>{view.label}</Badge>
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
