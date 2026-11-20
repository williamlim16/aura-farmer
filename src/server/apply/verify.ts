import type { Page } from "playwright";

import type { FieldDecision } from "~/lib/apply/decision/engine";
import { ensurePageShim } from "./page-shim";

export interface ReadBack {
  id: string;
  value: string | boolean | null;
  hasFile: boolean;
}

/** Read current values of all stamped fields from the DOM. */
export async function readBack(page: Page, ids: string[]): Promise<Map<string, ReadBack>> {
  await ensurePageShim(page);
  const rows = await page.evaluate((ids) => {
    const labelOf = (input: HTMLInputElement) => {
      const l = (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ?? input.closest("label");
      return (l?.textContent ?? input.value ?? "").replace(/\s+/g, " ").trim();
    };
    return ids.map((id) => {
      const group = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-af-group="${id}"]`));
      if (group.length) {
        const checked = group.filter((g) => g.checked).map(labelOf);
        return { id, value: checked.length ? checked.join("; ") : null, hasFile: false };
      }
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-af-id="${id}"]`);
      if (!el) return { id, value: null, hasFile: false };
      if (el instanceof HTMLSelectElement) {
        const o = el.selectedOptions[0];
        return { id, value: o && o.value !== "" ? (o.textContent ?? "").replace(/\s+/g, " ").trim() : null, hasFile: false };
      }
      if (el instanceof HTMLInputElement && el.type === "checkbox") return { id, value: el.checked, hasFile: false };
      if (el instanceof HTMLInputElement && el.type === "file") return { id, value: null, hasFile: (el.files?.length ?? 0) > 0 };
      return { id, value: el.value || null, hasFile: false };
    });
  }, ids);
  return new Map(rows.map((r) => [r.id, r]));
}

const norm = (v: string | boolean | null | undefined) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Did the DOM end up holding what we decided? */
export function matches(fd: FieldDecision, rb: ReadBack | undefined): boolean {
  if (!rb) return false;
  const d = fd.decision;
  if (d.action === "upload") return rb.hasFile;
  if (d.action !== "fill") return false;
  if (typeof rb.value === "boolean") return rb.value === (d.value === true || norm(d.value) === "yes");
  if (fd.field.control === "tel") return norm(rb.value).replace(/\D/g, "") === norm(d.value).replace(/\D/g, "");
  return norm(rb.value) === norm(d.value);
}
