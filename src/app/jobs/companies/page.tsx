import type { Metadata } from "next";

import { CompanyCard } from "~/components/companies/company-card";
import { PreferencesForm } from "~/components/companies/preferences-form";
import { FormAlert } from "~/components/form-alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/server/auth";
import { getCompanySearch } from "~/server/companies/store";

// The research run (web searches + several LLM calls) continues after the
// action responds, inside this invocation.
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Ideal Companies",
  description:
    "Companies that match your preferences, with every claim sourced.",
};

const dateTime = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function CompaniesPage() {
  const user = await requireUser();
  const search = await getCompanySearch(user.id);
  const result = search?.result ?? null;
  const running = search?.status === "running";

  return (
    <>
      <section className="space-y-2">
        <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          Ideal <span className="text-aura-gradient">companies</span>
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Describe where you&apos;d like to work. We search the web, research
          each match, and only show claims we can source to a company site,
          LinkedIn, Glassdoor, a job board or the news. Each [n] links to the
          exact passage.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Your preferences</CardTitle>
          <CardDescription>
            Location, industry, company size, culture, work arrangement,
            employment type: whatever matters to you. Your profile and target
            job titles are used too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm
            defaultValue={search?.preferences ?? ""}
            running={running}
            progress={search?.progress ?? null}
          />
        </CardContent>
      </Card>

      {search?.status === "failed" && search.error && (
        <FormAlert message={search.error} />
      )}

      {result && (
        <section className="space-y-4">
          <p className="text-muted-foreground text-xs">
            {result.companies.length} compan
            {result.companies.length === 1 ? "y" : "ies"} · researched{" "}
            {dateTime.format(new Date(result.generatedAt))}
            {result.droppedClaims > 0 &&
              ` · ${result.droppedClaims} unverifiable claim${result.droppedClaims === 1 ? "" : "s"} removed`}
            {running && " · showing previous results while the new search runs"}
          </p>
          {result.companies.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No company had enough verifiable information. Try broader
              preferences.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {result.companies.map((c, i) => (
                <CompanyCard key={c.name} company={c} index={i} />
              ))}
            </div>
          )}
          {result.skipped.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Also considered:{" "}
              {result.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}
            </p>
          )}
        </section>
      )}
    </>
  );
}
