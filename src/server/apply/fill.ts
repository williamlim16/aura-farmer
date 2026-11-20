import type { Frame, Locator, Page } from "playwright";

import { pickOption } from "~/lib/apply/option-match";
import type { FieldDecision } from "~/lib/apply/decision/engine";
import { fillCombobox } from "./combobox";

type Target = Page | Frame;

export interface FillResult {
  id: string;
  ok: boolean;
  error?: string;
  attempts: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function radioOrCheckboxByLabel(page: Target, groupId: string, option: string): Promise<Locator | null> {
  const els = page.locator(`[data-af-group="${groupId}"]`);
  const n = await els.count();
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    labels.push(
      await els.nth(i).evaluate((el) => {
        const input = el as HTMLInputElement;
        const l = (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ?? input.closest("label");
        return (l?.textContent ?? input.value ?? "").replace(/\s+/g, " ").trim();
      }),
    );
  }
  const i = pickOption(labels, option);
  return i >= 0 ? els.nth(i) : null;
}

async function fillOne(page: Target, fd: FieldDecision, resumePath: string | null): Promise<void> {
  const { field, decision } = fd;
  const loc = page.locator(`[data-af-id="${field.id}"]`).first();

  if (decision.action === "upload") {
    if (!resumePath) throw new Error("no resume file available");
    const ext = resumePath.split(".").pop()!.toLowerCase();
    const accept = field.accept.toLowerCase();
    if (accept && !accept.split(",").some((a) => { const t = a.trim(); return t === `.${ext}` || t === "*/*" || (ext === "pdf" && t === "application/pdf") || (ext === "docx" && t.includes("wordprocessingml")); })) {
      throw new Error(`this upload only accepts ${field.accept}; your resume is .${ext}`);
    }
    await loc.setInputFiles(resumePath);
    return;
  }
  if (decision.action !== "fill") return;
  const value = decision.value;

  switch (field.control) {
    case "combobox":
      await fillCombobox(page, loc, String(value), pickOption);
      return;
    case "select": {
      const i = pickOption(field.options, String(value));
      if (i < 0) throw new Error(`option "${String(value)}" not found`);
      await loc.selectOption({ label: field.options[i]! });
      return;
    }
    case "radio": {
      const target = await radioOrCheckboxByLabel(page, field.id, String(value));
      if (!target) throw new Error(`radio option "${String(value)}" not found`);
      await target.check();
      return;
    }
    case "checkbox": {
      if (field.multiple) {
        const target = await radioOrCheckboxByLabel(page, field.id, String(value));
        if (!target) throw new Error(`checkbox option "${String(value)}" not found`);
        await target.check();
      } else {
        await loc.setChecked(value === true || norm(String(value)) === "yes");
      }
      return;
    }
    default:
      // fill() replaces the value and dispatches input/change; never press Enter (it can submit).
      await loc.fill(String(value));
      // Some React-style inputs re-render; blur so validation/onChange handlers commit.
      await loc.evaluate((el) => (el as HTMLElement).blur());
  }
}

/** Fill each decided field independently; one failure never aborts the rest. */
export async function fillFields(page: Target, decisions: FieldDecision[], opts: { resumePath: string | null; retries?: number; actionTimeoutMs?: number }): Promise<FillResult[]> {
  const results: FillResult[] = [];
  if ("setDefaultTimeout" in page) page.setDefaultTimeout(opts.actionTimeoutMs ?? 3000);
  for (const fd of decisions) {
    if (fd.decision.action !== "fill" && fd.decision.action !== "upload") continue;
    let attempts = 0;
    let lastErr: unknown;
    const max = 1 + (opts.retries ?? 1);
    while (attempts < max) {
      attempts++;
      try {
        await fillOne(page, fd, opts.resumePath);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        await page.waitForTimeout(250 * attempts); // dynamic forms: give the DOM a moment
      }
    }
    results.push({ id: fd.field.id, ok: !lastErr, attempts, ...(lastErr ? { error: lastErr instanceof Error ? lastErr.message.split("\n")[0] : "fill failed" } : {}) });
  }
  return results;
}
