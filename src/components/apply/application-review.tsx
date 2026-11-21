"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, type BadgeTone } from "~/components/apply/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { ApplicationStatus } from "~/lib/applications/status";
import { apiFetch, SESSION_EXPIRED } from "~/lib/client/api";
import { displayValue, GROUP_LABEL, groupFields, STAGES, statusView, TIER_LABEL, type FieldGroup, type ReportFieldLike } from "~/lib/applications/view";

export interface ApplicationDTO {
  id: string;
  title: string | null;
  company: string | null;
  status: ApplicationStatus;
  useLlm: boolean;
  error: string | null;
  updatedAt: string;
  submittedAt: string | null;
  report: null | {
    fields: ReportFieldLike[];
    metrics: { fields: number; verified: number; needsHuman: number; errors: number; mismatches: number; requiredCompletion: number; llmCalls: number; durationMs: number };
    blockedSubmits: { inPage: number; network: number };
    steps?: { step: number; advanced: boolean; stoppedBecause?: string }[];
    formLocation?: string;
  };
}

interface LogsDTO {
  job: { status: string; attempts: number; maxAttempts: number; cancelRequested: boolean } | null;
  logs: { at: string; level: "info" | "warn" | "error"; message: string }[];
}

const GROUP_TONE: Record<FieldGroup, BadgeTone> = { filled: "success", review: "warning", blocked: "guard", problem: "danger", skipped: "neutral" };
const ORDER: FieldGroup[] = ["problem", "review", "blocked", "filled", "skipped"];

export function ApplicationReview({ initial }: { initial: ApplicationDTO }) {
  const [app, setApp] = useState(initial);
  const [logs, setLogs] = useState<LogsDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  const [shotVersion, setShotVersion] = useState(initial.updatedAt);
  const [handoff, setHandoff] = useState("");

  async function sendToExtension() {
    setHandoff("Preparing…");
    const r = await apiFetch<{ plan: { applicationId: string; fields: unknown[] } }>(`/api/applications/${app.id}/fill-plan`);
    if (!r.ok) return setHandoff(r.error);
    let acked = false;
    const onAck = (e: MessageEvent<{ type?: string }>) => {
      if (e.source === window && e.origin === window.location.origin && e.data?.type === "aura-farmer:fill-plan-received") acked = true;
    };
    window.addEventListener("message", onAck);
    window.postMessage({ type: "aura-farmer:fill-plan", plan: r.data.plan }, window.location.origin);
    await new Promise((res) => setTimeout(res, 1200));
    window.removeEventListener("message", onAck);
    setHandoff(acked ? `Sent ${r.data.plan.fields.length} answers to your browser extension. Open the employer's application page, click the Aura Farmer extension, then review and submit yourself.` : "The Aura Farmer extension was not detected in this browser. Install it (Chrome: chrome://extensions → Load unpacked → the repo's extension/ folder), reload this page and try again.");
  }
  const view = statusView(app.status);

  const refresh = useCallback(async () => {
    const [a, l] = await Promise.all([apiFetch<{ application: ApplicationDTO }>(`/api/applications/${app.id}`), apiFetch<LogsDTO>(`/api/applications/${app.id}/logs`)]);
    if (!a.ok && a.status === 401) return setMessage(SESSION_EXPIRED);
    if (a.ok) {
      setApp(a.data.application);
      setShotVersion(a.data.application.updatedAt);
    }
    if (l.ok) setLogs(l.data);
  }, [app.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const wasActive = useRef(view.active);
  useEffect(() => {
    if (!view.active) {
      // The worker writes its final log lines just after finishing; fetch once more.
      if (wasActive.current) {
        wasActive.current = false;
        const t = setTimeout(() => void refresh(), 1200);
        return () => clearTimeout(t);
      }
      return;
    }
    wasActive.current = true;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [view.active, refresh]);

  async function act(action: "rerun" | "cancel" | "mark_submitted", extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage("");
    try {
      const r = await apiFetch<{ application: ApplicationDTO }>(`/api/applications/${app.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      if (!r.ok) throw new Error(r.error);
      setApp(r.data.application);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const groups = app.report ? groupFields(app.report.fields) : null;
  const m = app.report?.metrics;
  const blocked = app.report ? app.report.blockedSubmits.inPage + app.report.blockedSubmits.network : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{app.title ?? "Application"}</h1>
          <p className="text-muted-foreground text-sm">{app.company}</p>
        </div>
        <Badge tone={view.tone} className="ml-auto text-sm">{view.label}</Badge>
      </div>

      <ol aria-label="Progress" className="grid grid-cols-4 gap-2 text-center text-xs">
        {STAGES.map((s, i) => (
          <li key={s} className={`rounded-md border px-2 py-2 ${i <= view.stageIndex ? "border-primary text-foreground font-semibold" : "text-muted-foreground"}`} aria-current={i === view.stageIndex ? "step" : undefined}>
            {s}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription role="status" aria-live="polite">{view.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {app.error && <p role="alert" className="text-destructive text-sm">{app.error}</p>}
          {app.report?.steps?.filter((s) => s.stoppedBecause).map((s) => (
            <p key={s.step} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              Stopped on step {s.step} of the form: {s.stoppedBecause}
            </p>
          ))}
          {app.report?.formLocation && app.report.formLocation !== "main" && (
            <p className="text-muted-foreground text-xs">The form was found inside an embedded frame ({app.report.formLocation}).</p>
          )}
          {app.status === "ready_for_review" && (
            <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">
              Nothing was submitted. {blocked > 0 && `The page tried to submit ${blocked} time(s); every attempt was blocked.`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {view.active && <Button variant="outline" onClick={() => void act("cancel")} disabled={busy || logs?.job?.cancelRequested}>{logs?.job?.cancelRequested ? "Cancelling…" : "Cancel run"}</Button>}
            {(app.status === "draft" || app.status === "failed" || app.status === "cancelled" || app.status === "ready_for_review") && (
              <Button variant={app.status === "draft" ? "default" : "outline"} onClick={() => void act("rerun")} disabled={busy}>
                {app.status === "draft" ? "Start autofill" : "Run again with my latest profile"}
              </Button>
            )}
          </div>
          {app.status === "ready_for_review" && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="text-sm">Fill the real application in your own browser with these reviewed answers:</p>
              <div><Button variant="outline" onClick={() => void sendToExtension()}>Send to browser extension</Button></div>
              {handoff && <p role="status" className="text-muted-foreground text-sm">{handoff}</p>}
            </div>
          )}
          {app.status === "ready_for_review" && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmSubmitted} onChange={(e) => setConfirmSubmitted(e.target.checked)} className="mt-1" />
                I reviewed every field and submitted this application myself on the employer&apos;s site.
              </label>
              <div>
                <Button onClick={() => void act("mark_submitted")} disabled={!confirmSubmitted || busy}>Record as submitted</Button>
              </div>
            </div>
          )}
          {message && (
            <p role="alert" className="text-destructive text-sm">
              {message} {message === SESSION_EXPIRED && <a href="/auth/login" className="underline">Sign in</a>}
            </p>
          )}
        </CardContent>
      </Card>

      {m && groups && (
        <Card>
          <CardHeader>
            <CardTitle>Review the filled form</CardTitle>
            <CardDescription>
              {m.verified} of {m.fields} fields filled and read back · {Math.round(m.requiredCompletion * 100)}% of required fields done · {m.llmCalls} model call(s) · {(m.durationMs / 1000).toFixed(1)}s
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {ORDER.filter((g) => groups[g].length).map((g) => (
              <section key={g} aria-labelledby={`grp-${g}`}>
                <h2 id={`grp-${g}`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  {GROUP_LABEL[g]} <Badge tone={GROUP_TONE[g]}>{groups[g].length}</Badge>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground text-xs">
                      <tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Decided by</th><th className="py-1 font-medium">{g === "filled" || g === "problem" ? "Value" : "Why"}</th></tr>
                    </thead>
                    <tbody>
                      {groups[g].map((f) => (
                        <tr key={f.id} className="border-t align-top">
                          <td className="py-2 pr-3">
                            {f.label || "(no label)"}
                            {f.required && <span className="text-muted-foreground ml-1 text-xs">required</span>}
                            {f.round > 1 && <span className="text-muted-foreground ml-1 text-xs">appeared later</span>}
                          </td>
                          <td className="py-2 pr-3"><Badge tone={f.tier}>{TIER_LABEL[f.tier]}</Badge></td>
                          <td className="py-2 break-words">
                            {displayValue(f)}
                            {f.reviewRequired && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">{f.tier === "llm" ? "AI draft: please edit" : "Your approved answer: check it fits this form"}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      )}

      {app.report && (
        <Card>
          <CardHeader>
            <CardTitle>Screenshot</CardTitle>
            <CardDescription>The filled form as the browser left it (not submitted).</CardDescription>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, per-user image from our API */}
            <img src={`/api/applications/${app.id}/screenshot?v=${encodeURIComponent(shotVersion)}`} alt="Screenshot of the filled application form" className="max-w-full rounded-md border" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Execution log</CardTitle>
          <CardDescription>{logs?.job ? `Attempt ${logs.job.attempts} of ${logs.job.maxAttempts} · job ${logs.job.status}` : "No runs yet."}</CardDescription>
        </CardHeader>
        <CardContent>
          {logs?.logs.length ? (
            <ol className="flex flex-col gap-1 font-mono text-xs">
              {logs.logs.map((l, i) => (
                <li key={i} className={l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
                  <time dateTime={l.at}>{new Date(l.at).toLocaleTimeString()}</time> {l.message}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">Logs appear here when the browser worker picks up the run.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
