import type { Frame, Page } from "playwright";

/**
 * Bundlers with keepNames (esbuild/tsx, some Next.js builds) rewrite named
 * inner functions as `__name(fn, "name")`. Functions passed to page.evaluate
 * run in the browser, where `__name` does not exist, so they throw. This shim
 * is a plain string (never transformed) that defines a no-op `__name`.
 */
export const NAME_SHIM = "globalThis.__name ??= (fn) => fn;";

export async function ensurePageShim(target: Page | Frame): Promise<void> {
  await target.evaluate(NAME_SHIM);
}
