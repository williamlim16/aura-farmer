import type { Frame, Page } from "playwright";

import type { FieldDecision } from "~/lib/apply/decision/engine";
import { ensurePageShim } from "./page-shim";

export interface ReadBack {
  id: string;
  value: string | boolean | null;
  hasFile: boolean;
  /** The form marked this control invalid (aria-invalid), with its message if any. */
  invalid?: string;
}

/** Read current values of all stamped fields from the DOM. */
export async function readBack(page: Page | Frame, ids: string[]): Promise<Map<string, ReadBack>> {
  await ensurePageShim(page);
  const rows = await page.evaluate((ids) => {
    const labelOf = (input: HTMLInputElement) => {
      const l = (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ?? input.closest("label");
      return (l?.textContent ?? input.value ?? "").replace(/\s+/g, " ").trim();
    };
    const invalidOf = (el: Element | null): string | undefined => {
      if (el?.getAttribute("aria-invalid") !== "true") return undefined;
      const ids2 = `${el.getAttribute("aria-describedby") ?? ""} ${el.getAttribute("aria-errormessage") ?? ""}`.trim().split(/\s+/).filter(Boolean);
      const msg = ids2.map((i) => { const n = document.getElementById(i); return n && !n.hidden ? (n.textContent ?? "").trim() : ""; }).filter(Boolean).join(" ");
      return msg || "The form marked this field as invalid.";
    };
    return ids.map((id) => {
      const ariaRadios = Array.from(document.querySelectorAll<HTMLElement>(`[data-af-aria-radio="${id}"]`));
      if (ariaRadios.length) {
        const on = ariaRadios.find((r) => r.getAttribute("aria-checked") === "true");
        return { id, value: on ? (on.textContent ?? "").replace(/\s+/g, " ").trim() : null, hasFile: false };
      }
      const group = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-af-group="${id}"]`));
      if (group.length) {
        const checked = group.filter((g) => g.checked).map(labelOf);
        return { id, value: checked.length ? checked.join("; ") : null, hasFile: false };
      }
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-af-id="${id}"]`);
      // Upload section shows the uploaded file's name (the input may have been replaced).
      const up = document.querySelector<HTMLElement>(`[data-af-upload="${id}"]`);
      const fileShown = !!up && !!up.dataset.afFile && (up.innerText || "").includes(up.dataset.afFile);
      if (!el) return { id, value: null, hasFile: fileShown };
      if (el.getAttribute("role") === "combobox") {
        // Custom dropdown: the chosen label is rendered next to the input.
        let root: HTMLElement | null = el.parentElement;
        while (root?.parentElement && root.innerText.trim().length === 0) root = root.parentElement;
        // innerText skips hidden option lists; only the rendered selection remains.
        const shown = (root?.innerText ?? "").replace(/\s+/g, " ").trim();
        return { id, value: shown || null, hasFile: false, invalid: invalidOf(el) };
      }
      if (el instanceof HTMLSelectElement) {
        const o = el.selectedOptions[0];
        return { id, value: o && o.value !== "" ? (o.textContent ?? "").replace(/\s+/g, " ").trim() : null, hasFile: false };
      }
      if (el instanceof HTMLInputElement && el.type === "checkbox") return { id, value: el.checked, hasFile: false };
      if (el instanceof HTMLInputElement && el.type === "file") return { id, value: null, hasFile: (el.files?.length ?? 0) > 0 || fileShown };
      return { id, value: el.value || null, hasFile: false, invalid: invalidOf(el) };
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
  if (fd.field.control === "combobox") {
    const shown = norm(rb.value);
    const want = norm(d.value);
    // Rendered selection may be the full option or a shortened display ("+61" for "Australia +61").
    return shown === want || (want.length > 0 && shown.includes(want)) || (shown.length >= 2 && want.includes(shown));
  }
  if (fd.field.control === "tel") return norm(rb.value).replace(/\D/g, "") === norm(d.value).replace(/\D/g, "");
  return norm(rb.value) === norm(d.value);
}
