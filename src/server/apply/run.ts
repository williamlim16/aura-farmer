import type { Frame, Page } from "playwright";

import type { DecisionEngine, FieldDecision } from "~/lib/apply/decision/engine";
import type { DecisionContext, ProviderUsage } from "~/lib/apply/decision/types";
import type { DecisionTier, FieldOutcome } from "~/lib/apply/types";
import { enrichComboboxOptions } from "./combobox";
import { extractForm } from "./extract-form";
import { fillFields } from "./fill";
import { ensurePageShim } from "./page-shim";
import type { SubmitGuard } from "./submit-guard";
import { matches, readBack, type ReadBack } from "./verify";

export interface FieldReport {
  id: string;
  label: string;
  control: string;
  kind: string;
  required: boolean;
  tier: DecisionTier | "guard";
  outcome: FieldOutcome;
  value?: string | boolean;
  reason?: string;
  reviewRequired?: boolean;
  round: number;
  /** 1-based form step (multi-step forms). */
  step: number;
}

export interface StepReport {
  step: number;
  advanced: boolean;
  /** Why the engine stopped on this step (only when not advanced). */
  stoppedBecause?: string;
}

export interface AutofillReport {
  /** Always true: this engine has no submit capability. */
  stoppedBeforeSubmit: true;
  fields: FieldReport[];
  steps: StepReport[];
  /** "main" or the URL path of the same-origin iframe that holds the form. */
  formLocation: string;
  metrics: {
    fields: number;
    required: number;
    verified: number;
    requiredVerified: number;
    needsHuman: number;
    errors: number;
    mismatches: number;
    /** verified / fields that were attempted (fill or upload). */
    fillAccuracy: number;
    /** required fields verified / required fields. */
    requiredCompletion: number;
    rounds: number;
    durationMs: number;
    decisionMs: number;
    llmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmCostUsd: number;
    byTier: Record<string, number>;
    /** Browser actions performed (fills, selects, checks, uploads, step clicks). */
    browserActions: number;
  };
  blockedSubmits: { inPage: number; network: number };
}

type Target = Page | Frame;

/**
 * Where the form lives: the main document if it has fields, else the
 * same-origin iframe with the most fields. Cross-origin frames are never used
 * (and are blocked by the egress allowlist anyway).
 */
async function pickFormTarget(page: Page): Promise<{ target: Target; location: string }> {
  const main = await extractForm(page).catch(() => []);
  if (main.length) return { target: page, location: "main" };
  const origin = new URL(page.url()).origin;
  let best: { frame: Frame; n: number } | null = null;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let fo = "";
    try {
      fo = new URL(frame.url()).origin;
    } catch {
      continue;
    }
    if (fo !== origin) continue;
    await frame.waitForLoadState("domcontentloaded").catch(() => undefined);
    const n = (await extractForm(frame).catch(() => [])).length;
    if (n && (!best || n > best.n)) best = { frame, n };
  }
  return best ? { target: best.frame, location: new URL(best.frame.url()).pathname } : { target: page, location: "main" };
}

const NEXT_RE = /^(next|continue|save (?:and|&) continue|proceed|next step)\b/i;
const SUBMITTISH_RE = /submit|apply|send|finish|complete (?:my )?application|review and submit/i;

/** A visible "Next"/"Continue" control that does not submit the form. */
async function findNextControl(target: Target): Promise<{ selector: string; submits: boolean } | null> {
  await ensurePageShim(target);
  // A per-call random marker, so a page cannot pre-plant the attribute to redirect our click.
  const nonce = `af-next-${crypto.randomUUID()}`;
  return target.evaluate(
    ({ next, submitish, nonce }) => {
      const nextRe = new RegExp(next, "i");
      const subRe = new RegExp(submitish, "i");
      const els = Array.from(document.querySelectorAll<HTMLElement>("button, input[type=button], input[type=submit], [role=button], a[role=button]"));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest("[hidden]") || (el as HTMLButtonElement).disabled) continue;
        const text = ([(el as HTMLInputElement).value, el.textContent, el.getAttribute("aria-label")].find((t) => t?.trim()) ?? "").replace(/\s+/g, " ").trim();
        if (!nextRe.test(text) || subRe.test(text)) continue;
        const isButton = el.tagName === "BUTTON";
        const type = (el.getAttribute("type") ?? (isButton ? "submit" : "")).toLowerCase();
        const submits = (isButton && type === "submit" && !!el.closest("form")) || (el.tagName === "INPUT" && type === "submit");
        el.setAttribute("data-af-next", nonce);
        return { selector: `[data-af-next="${nonce}"]`, submits };
      }
      return null;
    },
    { next: NEXT_RE.source, submitish: SUBMITTISH_RE.source, nonce },
  );
}

/** Visible validation messages the form is showing. */
async function visibleErrors(target: Target): Promise<string[]> {
  await ensurePageShim(target);
  return target.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll<HTMLElement>("[aria-invalid='true']").forEach((el) => {
      if (el.closest("[hidden]")) return;
      const ids = `${el.getAttribute("aria-describedby") ?? ""} ${el.getAttribute("aria-errormessage") ?? ""}`.trim().split(/\s+/).filter(Boolean);
      const msg = ids.map((i) => document.getElementById(i)).filter((n): n is HTMLElement => !!n && !n.hidden).map((n) => (n.textContent ?? "").trim()).join(" ");
      out.add(msg || `${el.getAttribute("aria-label") ?? el.getAttribute("name") ?? "A field"} is invalid`);
    });
    document.querySelectorAll<HTMLElement>("[role=alert]").forEach((el) => {
      const t = (el.textContent ?? "").trim();
      if (t && !el.closest("[hidden]") && el.getBoundingClientRect().height > 0) out.add(t);
    });
    return [...out].slice(0, 5).map((m) => m.slice(0, 160));
  });
}

/**
 * Extract -> decide -> fill -> verify, repeated while new fields appear
 * (conditional / delayed sections), then advance through multi-step forms by
 * clicking a non-submitting "Next" only when every required field on the
 * current step verified. Never submits.
 */
export async function runAutofill(
  page: Page,
  engine: DecisionEngine,
  ctx: DecisionContext,
  opts: { resumePath: string | null; guard: SubmitGuard; maxRounds?: number; maxSteps?: number; settleMs?: number },
): Promise<AutofillReport> {
  const t0 = performance.now();
  const all: (FieldDecision & { round: number; step: number; fillOk?: boolean; fillErr?: string })[] = [];
  const seen = new Set<string>();
  const steps: StepReport[] = [];
  const byTier: Record<string, number> = {};
  const usage: Partial<Record<DecisionTier, ProviderUsage>> = {};
  let decisionMs = 0;
  let totalRounds = 0;
  let browserActions = 0;
  const settle = opts.settleMs ?? 400;
  /** Read-back captured when a step was left (its fields are hidden afterwards). */
  const finalBack = new Map<string, ReadBack>();

  page.setDefaultTimeout(3000);
  const { target, location } = await pickFormTarget(page);

  for (let step = 1; step <= (opts.maxSteps ?? 5); step++) {
    for (let round = 1; round <= (opts.maxRounds ?? 3); round++) {
      const fields = (await extractForm(target)).filter((f) => !seen.has(f.id));
      if (!fields.length) break;
      totalRounds++;
      fields.forEach((f) => seen.add(f.id));
      await enrichComboboxOptions(target, fields);

      const td = performance.now();
      const { decisions, stats } = await engine.decide(fields, ctx);
      decisionMs += performance.now() - td;
      for (const [k, v] of Object.entries(stats.byTier)) byTier[k] = (byTier[k] ?? 0) + v;
      Object.assign(usage, stats.usage); // providers report cumulative usage

      const results = await fillFields(target, decisions, { resumePath: opts.resumePath });
      browserActions += results.filter((r) => r.ok).length;
      for (const d of decisions) {
        const r = results.find((x) => x.id === d.field.id);
        all.push({ ...d, round, step, fillOk: r?.ok, fillErr: r?.error });
      }
      await target.waitForTimeout(settle); // let conditional fields render
    }

    const next = await findNextControl(target);
    if (!next) break; // single-page form, or the last step (only a submit button left)

    const stepItems = all.filter((a) => a.step === step);
    const rb = await readBack(target, stepItems.map((a) => a.field.id));
    const blocking = stepItems.filter((a) => a.field.required && !(a.decision.action !== "human" && a.decision.action !== "skip" && a.fillOk !== false && matches(a, rb.get(a.field.id)) && !rb.get(a.field.id)?.invalid));
    if (blocking.length) {
      steps.push({ step, advanced: false, stoppedBecause: `${blocking.length} required field(s) on this step need your input before continuing.` });
      break;
    }
    if (next.submits) {
      steps.push({ step, advanced: false, stoppedBecause: "The Continue button on this step would submit the form, so you need to continue yourself." });
      break;
    }
    await target.locator(next.selector).first().click();
    browserActions++;
    await target.waitForTimeout(settle);
    const errs = await visibleErrors(target);
    const stillHere = await target.locator(next.selector).first().isVisible().catch(() => false);
    await target.evaluate(() => document.querySelectorAll("[data-af-next]").forEach((e) => e.removeAttribute("data-af-next"))).catch(() => undefined);
    if (errs.length || stillHere) {
      steps.push({ step, advanced: false, stoppedBecause: errs.length ? `The form reported: ${errs.join("; ")}` : "The form did not move to the next step." });
      break;
    }
    // Only now is this step final: its fields are hidden and were valid when we left.
    rb.forEach((v, k) => finalBack.set(k, v));
    steps.push({ step, advanced: true });
  }

  const finalIds = all.filter((a) => !finalBack.has(a.field.id)).map((a) => a.field.id);
  let rb: Map<string, ReadBack> = await readBack(target, finalIds);
  // Uploads finish asynchronously (the ATS shows the file name when its upload completes): wait for them.
  const pendingUploads = () => all.filter((a) => a.decision.action === "upload" && a.fillOk !== false && finalIds.includes(a.field.id) && !rb.get(a.field.id)?.hasFile);
  for (let waited = 0; pendingUploads().length && waited < 20000; waited += 500) {
    await target.waitForTimeout(500);
    rb = await readBack(target, finalIds);
  }
  finalBack.forEach((v, k) => rb.set(k, v));
  const fields: FieldReport[] = all.map((a) => {
    const d = a.decision;
    const back = rb.get(a.field.id);
    let outcome: FieldOutcome;
    let reason: string | undefined;
    if (d.action === "human") outcome = "needs_human";
    else if (d.action === "skip") outcome = "skipped";
    else if (a.fillOk === false) outcome = "error";
    else if (back?.invalid) {
      outcome = "error";
      reason = `The form rejected this value: ${back.invalid}`;
    } else outcome = matches(a, back) ? "verified" : "mismatch";
    return {
      id: a.field.id,
      label: a.field.label,
      control: a.field.control,
      kind: a.classification.kind,
      required: a.field.required,
      tier: d.tier,
      outcome,
      ...(d.action === "fill" ? { value: d.value, reviewRequired: d.reviewRequired } : {}),
      ...(d.action === "human" || d.action === "skip" ? { reason: d.reason } : {}),
      ...(a.fillErr ? { reason: a.fillErr } : {}),
      ...(reason ? { reason } : {}),
      round: a.round,
      step: a.step,
    };
  });

  const attempted = fields.filter((f) => f.outcome === "verified" || f.outcome === "mismatch" || f.outcome === "error");
  const required = fields.filter((f) => f.required);
  const verified = fields.filter((f) => f.outcome === "verified");
  const llm = usage.llm;
  return {
    stoppedBeforeSubmit: true,
    fields,
    steps,
    formLocation: location,
    metrics: {
      fields: fields.length,
      required: required.length,
      verified: verified.length,
      requiredVerified: required.filter((f) => f.outcome === "verified").length,
      needsHuman: fields.filter((f) => f.outcome === "needs_human").length,
      errors: fields.filter((f) => f.outcome === "error").length,
      mismatches: fields.filter((f) => f.outcome === "mismatch").length,
      fillAccuracy: attempted.length ? verified.length / attempted.length : 1,
      requiredCompletion: required.length ? required.filter((f) => f.outcome === "verified").length / required.length : 1,
      rounds: totalRounds,
      durationMs: performance.now() - t0,
      decisionMs,
      llmCalls: llm?.calls ?? 0,
      llmInputTokens: llm?.inputTokens ?? 0,
      llmOutputTokens: llm?.outputTokens ?? 0,
      llmCostUsd: llm?.costUsd ?? 0,
      byTier,
      browserActions,
    },
    blockedSubmits: { inPage: await opts.guard.blockedInPage(page), network: opts.guard.blockedNetwork.length },
  };
}
