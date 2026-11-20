import type { ResumeKind } from "~/lib/resume/validate";

export class ResumeTextError extends Error {
  constructor(
    message: string,
    readonly code: "no_text" | "encrypted" | "corrupt",
  ) {
    super(message);
    this.name = "ResumeTextError";
  }
}

const MAX_CHARS = 60_000;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "") // zero-width chars (hidden-text payloads)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

/** Extract plain text from a validated resume. Deterministic, no network. */
export async function extractResumeText(bytes: Uint8Array, kind: ResumeKind): Promise<string> {
  let text: string;
  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      // unpdf/pdf.js may detach the buffer it is given; pass a copy.
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const res = await extractText(pdf, { mergePages: true });
      text = res.text;
    } else {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = res.value;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(msg)) {
      throw new ResumeTextError("This PDF is password-protected.", "encrypted");
    }
    throw new ResumeTextError("Could not read this file.", "corrupt");
  }
  const clean = normalise(text);
  if (clean.replace(/\s/g, "").length < 40) {
    throw new ResumeTextError(
      "No readable text found. Scanned/image-only resumes are not supported yet.",
      "no_text",
    );
  }
  return clean;
}
