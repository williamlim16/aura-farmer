/**
 * LaTeX → PDF via Octree (https://useoctree.com/developers).
 *
 * The free plan allows only 30 compiles a day, shared by everyone using this
 * app, so callers must compile at most once per user action and never retry
 * automatically. LaTeX errors come back as HTTP 200 with `ok: false`.
 */

import { env } from "~/env";

const COMPILE_URL = "https://app.useoctree.com/api/v1/compile";
const TIMEOUT_MS = 90_000;

interface OctreeCompileResponse {
  ok?: boolean;
  pdf_base64?: string;
  pages?: number;
  errors?: Array<{ line?: number; message?: string; kind?: string }>;
  error?: string | { code?: string; message?: string };
  code?: string;
  message?: string;
}

export type CompileResult =
  | { ok: true; pdf: Buffer; pages: number | null }
  | { ok: false; message: string };

export async function compileLatex(latex: string): Promise<CompileResult> {
  if (!env.OCTREE_API_KEY) {
    return {
      ok: false,
      message: "PDF compiling isn't configured (OCTREE_API_KEY).",
    };
  }

  let res: Response;
  try {
    res = await fetch(COMPILE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OCTREE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ latex, response: "json" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.error("Octree compile request failed", err);
    return { ok: false, message: "Couldn't reach the PDF compiler." };
  }

  const body = (await res
    .json()
    .catch(() => null)) as OctreeCompileResponse | null;

  if (res.status === 429) {
    return {
      ok: false,
      message: "Daily PDF compile limit reached. Try again after midnight UTC.",
    };
  }
  if (!res.ok || !body) {
    const code =
      (typeof body?.error === "object" ? body.error.code : body?.error) ??
      body?.code ??
      res.statusText;
    console.error("Octree compile failed", res.status, code);
    return {
      ok: false,
      message:
        res.status >= 500
          ? "The PDF compiler is busy or timed out. Try again later."
          : `PDF compile failed (${res.status}).`,
    };
  }

  if (!body.ok || !body.pdf_base64) {
    const first = body.errors?.[0];
    const detail = first?.message
      ? `${first.message}${first.line ? ` (line ${first.line})` : ""}`
      : "unknown LaTeX error";
    console.error("Octree LaTeX errors", body.errors);
    return { ok: false, message: `LaTeX error: ${detail}` };
  }

  return {
    ok: true,
    pdf: Buffer.from(body.pdf_base64, "base64"),
    pages: body.pages ?? null,
  };
}
