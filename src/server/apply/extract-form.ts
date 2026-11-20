import type { Frame, Page } from "playwright";

import type { FormField } from "~/lib/apply/types";
import { ensurePageShim } from "./page-shim";

/**
 * Extract visible, fillable controls from the page and stamp each with
 * data-af-id. Radios sharing a name collapse into one field with options.
 * Already-stamped controls keep their id, so re-extraction after a dynamic
 * change only surfaces genuinely new fields.
 */
export async function extractForm(target: Page | Frame): Promise<FormField[]> {
  await ensurePageShim(target);
  return target.evaluate(() => {
    const SKIP_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "password", "search"]);
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/, "").trim();
    const visible = (el: Element) => {
      const he = el as HTMLElement;
      // File inputs are often display:none behind a styled "Upload" button; keep them.
      if ((he as HTMLInputElement).type === "file") return true;
      if (he.closest("[hidden],[aria-hidden='true']")) return false;
      const st = getComputedStyle(he);
      if (st.display === "none" || st.visibility === "hidden") return false;
      // File inputs are often visually hidden behind a styled button; keep them.
      if ((he as HTMLInputElement).type === "file") return true;
      const r = he.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const textOf = (el: Element | null) => clean(el?.textContent);
    const win = window as unknown as { __afSeq?: number };

    function labelFor(el: HTMLElement): { label: string; source: FormField["labelSource"] } {
      const id = el.id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l && textOf(l)) return { label: textOf(l), source: "label-for" };
      }
      const wrap = el.closest("label");
      if (wrap) {
        const copy = wrap.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input,select,textarea,option").forEach((n) => n.remove());
        if (clean(copy.textContent)) return { label: clean(copy.textContent), source: "label-wrap" };
      }
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb.split(/\s+/).map((i) => textOf(document.getElementById(i))).join(" ").trim();
        if (t) return { label: t, source: "aria-labelledby" };
      }
      const al = el.getAttribute("aria-label");
      if (clean(al)) return { label: clean(al), source: "aria-label" };
      const ph = el.getAttribute("placeholder");
      if (clean(ph)) return { label: clean(ph), source: "placeholder" };
      // Nearby text: closest previous sibling / parent's leading text without controls.
      let node: Element | null = el;
      for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
        let prev = node.previousElementSibling;
        while (prev && !textOf(prev)) prev = prev.previousElementSibling;
        if (prev && !prev.querySelector("input,select,textarea") && textOf(prev).length <= 200) {
          return { label: textOf(prev), source: "nearby-text" };
        }
      }
      const nm = el.getAttribute("name");
      return nm ? { label: "", source: "name" } : { label: "", source: "none" };
    }

    function stamp(el: Element): string {
      let id = el.getAttribute("data-af-id");
      if (!id) {
        win.__afSeq = (win.__afSeq ?? 0) + 1;
        id = `f${win.__afSeq}`;
        el.setAttribute("data-af-id", id);
      }
      return id;
    }

    const out: FormField[] = [];
    const radioGroups = new Map<string, HTMLInputElement[]>();
    const checkboxGroups = new Map<string, HTMLInputElement[]>();
    const controls = Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"));

    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      const input = el as HTMLInputElement;
      const type = tag === "input" ? (input.type || "text").toLowerCase() : tag;
      if (SKIP_TYPES.has(type) || input.disabled || !visible(el)) continue;
      // Honeypots: off-screen or explicitly hidden-from-humans fields.
      if (el.getAttribute("tabindex") === "-1" && /honey|trap|bot/i.test(el.getAttribute("name") ?? "")) continue;

      if (type === "radio") {
        const key = input.name || stamp(el);
        radioGroups.set(key, [...(radioGroups.get(key) ?? []), input]);
        continue;
      }
      if (type === "checkbox" && input.name && document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(input.name)}"]`).length > 1) {
        checkboxGroups.set(input.name, [...(checkboxGroups.get(input.name) ?? []), input]);
        continue;
      }

      const { label, source } = labelFor(el);
      const isCombo = tag !== "select" && el.getAttribute("role") === "combobox";
      const control: FormField["control"] = isCombo ? "combobox" :
        tag === "select" ? "select" : tag === "textarea" ? "textarea" :
        (["email", "tel", "url", "number", "date", "file", "checkbox"].includes(type) ? type : "text") as FormField["control"];
      out.push({
        id: stamp(el),
        control,
        label,
        labelSource: source,
        name: input.name ?? "",
        htmlId: el.id ?? "",
        placeholder: el.getAttribute("placeholder") ?? "",
        autocomplete: el.getAttribute("autocomplete") ?? "",
        required: input.required || el.getAttribute("aria-required") === "true",
        options: tag === "select"
          ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "" && !o.disabled).map((o) => clean(o.textContent))
          : [],
        multiple: tag === "select" ? (el as HTMLSelectElement).multiple : false,
        accept: input.accept ?? "",
      });
    }

    const groupLabel = (els: HTMLInputElement[]) => {
      const fs = els[0]!.closest("fieldset");
      const rg = els[0]!.closest("[role=radiogroup],[role=group]");
      // Prefer the nearest labelled container: a role=radiogroup nested inside a
      // section-level <fieldset> ("Questions") carries the actual question.
      const rgIsNearer = !!rg && (!fs || fs.contains(rg));
      const rgLabel = () => {
        const lb = rg?.getAttribute("aria-labelledby");
        if (lb) {
          const t = lb.split(/\s+/).map((i) => textOf(document.getElementById(i))).join(" ").trim();
          if (t) return { label: t, source: "aria-labelledby" as const };
        }
        const al = clean(rg?.getAttribute("aria-label"));
        return al ? { label: al, source: "aria-label" as const } : null;
      };
      if (rgIsNearer) {
        const r = rgLabel();
        if (r) return r;
      }
      const legend = fs?.querySelector("legend");
      if (legend && textOf(legend)) return { label: textOf(legend), source: "legend" as const };
      const r = rgLabel();
      if (r) return r;
      let prev = (fs ?? rg ?? els[0]!.parentElement)?.previousElementSibling ?? null;
      while (prev && !textOf(prev)) prev = prev.previousElementSibling;
      return prev ? { label: textOf(prev), source: "nearby-text" as const } : { label: "", source: "none" as const };
    };

    for (const [control, groups] of [["radio", radioGroups], ["checkbox", checkboxGroups]] as const) {
      for (const [name, els] of groups) {
        const { label, source } = groupLabel(els);
        const groupId = els[0]!.getAttribute("data-af-group") ?? stamp(els[0]!);
        els.forEach((e) => e.setAttribute("data-af-group", groupId));
        out.push({
          id: groupId,
          control: control === "radio" ? "radio" : "checkbox",
          label,
          labelSource: source,
          name,
          htmlId: "",
          placeholder: "",
          autocomplete: "",
          required: els.some((e) => e.required),
          options: els.map((e) => labelFor(e).label || e.value),
          multiple: control === "checkbox",
          accept: "",
        });
      }
    }
    // Groups were appended after singles; restore on-page order for the review UI.
    const firstEl = (f: FormField) =>
      document.querySelector(`[data-af-id="${f.id}"]`) ?? document.querySelector(`[data-af-group="${f.id}"]`);
    out.sort((a, b) => {
      const ea = firstEl(a), eb = firstEl(b);
      if (!ea || !eb || ea === eb) return 0;
      return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    // ARIA radio groups made of buttons (e.g. Ashby yes/no toggles).
    document.querySelectorAll<HTMLElement>("[role=radiogroup]").forEach((g) => {
      if (g.querySelector("input[type=radio]")) return; // native radios already handled above
      const radios = Array.from(g.querySelectorAll<HTMLElement>("[role=radio]")).filter((r) => r.tagName !== "INPUT" && visible(r));
      if (!radios.length) return;
      const lb = g.getAttribute("aria-labelledby");
      const label = lb ? lb.split(/\s+/).map((i) => textOf(document.getElementById(i))).join(" ").trim() : clean(g.getAttribute("aria-label"));
      const id = g.getAttribute("data-af-group") ?? stamp(g);
      g.setAttribute("data-af-group", id);
      radios.forEach((r) => r.setAttribute("data-af-aria-radio", id));
      out.push({ id, control: "radio", label, labelSource: label ? "aria-labelledby" : "none", name: "", htmlId: g.id, placeholder: "", autocomplete: "", required: g.getAttribute("aria-required") === "true", options: radios.map((r) => clean(r.textContent)), multiple: false, accept: "" });
    });
    return out;
  });
}
