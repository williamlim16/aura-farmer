import {
  Briefcase,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  FACT_CATEGORIES,
  FACT_CATEGORY_LABELS,
  fitSummary,
  type CompanyResult,
  type Evidence,
} from "~/server/companies/types";
import { AddRoleButton } from "./add-role-button";

/**
 * Link to the source that scrolls to and highlights the quote (text
 * fragments; browsers without support just open the page).
 */
function quoteLink(url: string, quote: string): string {
  if (url.includes("#")) return url;
  const words = quote.split(/\s+/).filter(Boolean);
  const start = words.slice(0, 6).join(" ");
  const end = words.length > 10 ? words.slice(-4).join(" ") : null;
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  return `${url}#:~:text=${enc(start)}${end ? `,${enc(end)}` : ""}`;
}

function Cite({ company, e }: { company: CompanyResult; e: Evidence }) {
  const source = company.sources[e.source];
  if (!source) return null;
  return (
    <a
      href={quoteLink(source.url, e.quote)}
      target="_blank"
      rel="noopener noreferrer"
      title={`"${e.quote}" (${source.domain})`}
      className="text-aura-primary ml-1 align-super font-mono text-[10px] hover:underline"
    >
      [{e.source + 1}]
    </a>
  );
}

export function CompanyCard({
  company,
  requirements,
  index,
}: {
  company: CompanyResult;
  /** The run's requirements; `company.checks` index into these. */
  requirements: string[];
  index: number;
}) {
  const fit = fitSummary(company);
  const factsByCategory = FACT_CATEGORIES.map((cat) => ({
    cat,
    facts: company.facts.filter((f) => f.category === cat),
  })).filter((g) => g.facts.length > 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="teal"
            title={`${fit.met} of your ${fit.total} requirements met · ${fit.notMet} not met · ${fit.unknown} unknown`}
          >
            Fit {fit.met}/{fit.total}
          </Badge>
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs"
            >
              Website <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          )}
        </div>
        <CardTitle className="text-lg">{company.name}</CardTitle>
        <p className="text-muted-foreground text-sm">{company.verdict}</p>
      </CardHeader>

      <CardContent className="space-y-5 text-sm">
        <ul className="space-y-1.5">
          {company.checks.map((c) => (
            <li key={c.requirement} className="flex gap-2">
              {c.status === "met" ? (
                <CircleCheck
                  aria-label="Met"
                  className="text-aura-secondary mt-0.5 size-4 shrink-0"
                />
              ) : c.status === "not_met" ? (
                <CircleX
                  aria-label="Not met"
                  className="text-destructive mt-0.5 size-4 shrink-0"
                />
              ) : (
                <CircleHelp
                  aria-label="Unknown"
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
              )}
              <span>
                <span className="font-medium">
                  {requirements[c.requirement]}
                </span>
                {c.evidence ? (
                  <>
                    {c.finding && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {c.finding}
                      </span>
                    )}
                    <Cite company={company} e={c.evidence} />
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    · not found in sources
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-2">
          {factsByCategory.map(({ cat, facts }) => (
            <div key={cat}>
              <dt className="text-muted-foreground font-mono text-[11px] uppercase">
                {FACT_CATEGORY_LABELS[cat]}
              </dt>
              {facts.map((f, i) => (
                <dd key={i}>
                  {f.statement}
                  <Cite company={company} e={f} />
                </dd>
              ))}
            </div>
          ))}
        </dl>

        {company.openRoles.length > 0 && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 font-medium">
              <Briefcase aria-hidden="true" className="size-4" />
              Relevant open roles
            </h3>
            <ul className="space-y-2">
              {company.openRoles.map((r, i) => (
                <li
                  key={i}
                  className="border-border flex items-start justify-between gap-3 rounded-lg border p-2.5"
                >
                  <div className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {r.title}
                    </a>
                    <Cite company={company} e={r} />
                    <p className="text-muted-foreground text-xs">
                      {[r.location, r.workArrangement, r.employmentType]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <AddRoleButton companyIndex={index} roleIndex={i} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1">
          <h3 className="text-muted-foreground font-mono text-[11px] uppercase">
            Sources
          </h3>
          <ol className="space-y-1 text-xs">
            {company.sources.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground font-mono">
                  [{i + 1}]
                </span>
                <Badge variant="outline" className="shrink-0">
                  {s.kind}
                </Badge>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:underline"
                  title={s.url}
                >
                  {s.title || s.domain}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
