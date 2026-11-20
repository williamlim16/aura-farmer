/**
 * Plain, ATS-friendly single-column resume PDF from a (tailored) profile.
 * pdf-lib only: works in serverless and in the worker, no browser needed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { CandidateProfile } from "~/lib/profile/schema";

// Standard fonts are WinAnsi-only; replace characters they cannot encode.
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function renderResumePdf(p: CandidateProfile): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 50, maxW = W - 2 * M;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const line = (text: string, f: PDFFont, size: number, indent = 0, color = rgb(0.1, 0.1, 0.1)) => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    let cur = "";
    const flush = () => {
      if (y < M + size) {
        page = doc.addPage([W, H]);
        y = H - M;
      }
      page.drawText(cur, { x: M + indent, y, size, font: f, color });
      y -= size * 1.35;
      cur = "";
    };
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > maxW - indent && cur) flush();
      cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) flush();
  };
  const heading = (t: string) => {
    y -= 6;
    line(t.toUpperCase(), bold, 10.5, 0, rgb(0.15, 0.25, 0.5));
  };

  const c = p.contact;
  line(c.fullName?.value ?? "Candidate", bold, 18);
  line([c.location?.value, c.email?.value, c.phone?.value].filter(Boolean).join("  |  "), font, 9.5);
  const links = [c.linkedin?.value, c.github?.value, c.website?.value].filter(Boolean).join("  |  ");
  if (links) line(links, font, 9.5);
  if (p.summary) {
    heading("Summary");
    line(p.summary, font, 10.5);
  }
  if (p.experience.length) {
    heading("Experience");
    for (const e of p.experience) {
      line(`${e.title}, ${e.company}`, bold, 10.5);
      if (e.start || e.end) line(`${e.start ?? ""} - ${e.end ?? ""}`, font, 9.5, 0, rgb(0.35, 0.35, 0.35));
      for (const b of e.bullets) line(`- ${b}`, font, 10, 10);
      y -= 3;
    }
  }
  if (p.education.length) {
    heading("Education");
    for (const e of p.education) line(`${e.degree}, ${e.institution}${e.start || e.end ? ` (${[e.start, e.end].filter(Boolean).join(" - ")})` : ""}`, font, 10.5);
  }
  if (p.skills.length) {
    heading("Skills");
    line(p.skills.join(", "), font, 10.5);
  }
  return doc.save();
}
