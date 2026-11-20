import type { Frame, Locator, Page } from "playwright";

import type { FormField } from "~/lib/apply/types";

type Target = Page | Frame;

/** Visible options of the listbox a combobox controls (or the nearest visible listbox). */
async function visibleOptions(target: Target, combo: Locator): Promise<Locator> {
  const listId = await combo.getAttribute("aria-controls");
  const scoped = listId ? target.locator(`[id="${listId.replace(/"/g, "")}"] [role=option]`) : target.locator("[role=listbox]:visible [role=option]");
  return scoped;
}

/**
 * Custom comboboxes (react-select style) only render options when opened.
 * Open each one, read its options, and close it again with Escape (never
 * Enter, which can submit the form).
 */
export async function enrichComboboxOptions(target: Target, fields: FormField[]): Promise<void> {
  for (const f of fields) {
    if (f.control !== "combobox" || f.options.length) continue;
    const combo = target.locator(`[data-af-id="${f.id}"]`).first();
    try {
      await combo.click({ timeout: 2000 });
      const opts = await visibleOptions(target, combo);
      await opts.first().waitFor({ state: "visible", timeout: 1500 });
      f.options = (await opts.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 200);
    } catch {
      /* async-loaded or empty: leave options empty; the fill step types and picks */
    } finally {
      await combo.press("Escape").catch(() => undefined);
    }
  }
}

/** Type to filter, then click the single safe match. Throws if no unambiguous option. */
export async function fillCombobox(target: Target, combo: Locator, value: string, pick: (options: string[], v: string) => number): Promise<void> {
  await combo.click();
  await combo.fill("");
  await combo.pressSequentially(value.slice(0, 40), { delay: 15 });
  const opts = await visibleOptions(target, combo);
  await opts.first().waitFor({ state: "visible", timeout: 2000 });
  const texts = (await opts.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const i = pick(texts, value);
  if (i < 0) {
    await combo.press("Escape").catch(() => undefined);
    throw new Error(`no unambiguous option for "${value}"`);
  }
  await opts.nth(i).click();
}
