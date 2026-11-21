/**
 * A realistic synthetic resume (fictional person) laid out like common
 * Word/Google Docs exports: right-aligned dates on the title line, company
 * and city on the next line, wrapped bullets and summary, location inside the
 * contact line, labelled skill groups. Used for parser regression tests and
 * the end-to-end run. All details are fictional (example.com, 555 numbers).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const MORGAN = {
  fullName: "Morgan Lee",
  email: "morgan.lee@example.com",
  phone: "+61 412 555 019",
  location: "Sydney, NSW, Australia",
  linkedin: "https://linkedin.com/in/morgan-lee-demo",
  github: "https://github.com/morganlee-demo",
  summary: "Full-stack engineer with 7 years of experience building data-heavy web products with TypeScript and React. I care about reliable delivery, clear communication and mentoring.",
  experience: [
    { title: "Senior Full-Stack Engineer", company: "Acme Analytics", city: "Sydney, NSW", start: "Mar 2022", end: "Present", bullets: ["Led the rebuild of the customer reporting portal in Next.js and TypeScript, cutting page load time by 45% for 30,000 monthly users.", "Introduced Playwright end-to-end tests and a CI pipeline in GitHub Actions, reducing production regressions by a third.", "Mentored four engineers and ran weekly design reviews with product and data teams."] },
    { title: "Software Engineer", company: "Blue Harbour Logistics", city: "Melbourne, VIC", start: "Feb 2018", end: "Feb 2022", bullets: ["Built shipment tracking APIs in Node.js and PostgreSQL handling two million events per day.", "Migrated services to Docker on AWS ECS and set up monitoring dashboards.", "Worked with operations stakeholders to prioritise features and communicate releases."] },
  ],
  education: [{ degree: "Bachelor of Software Engineering (Honours)", institution: "University of New South Wales", start: "2014", end: "2017" }],
  technicalSkills: ["TypeScript", "JavaScript", "React", "Next.js", "Node.js", "PostgreSQL", "AWS", "Docker", "Playwright", "GraphQL"],
  softSkills: ["Stakeholder communication", "Mentoring", "Agile delivery"],
};

export async function makeRealisticResumePdf(): Promise<Uint8Array> {
  const m = MORGAN;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const L = 50, R = 545, W = R - L;
  let y = 790;
  const text = (t: string, x: number, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(t, { x, y, size, font: f, color });
  const right = (t: string, size = 10, f = font) => text(t, R - f.widthOfTextAtSize(t, size), size, f);
  const wrap = (t: string, x: number, size: number, width: number) => {
    const words = t.split(" ");
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        text(line, x, size);
        y -= size + 3;
        line = w;
      } else line = next;
    }
    if (line) {
      text(line, x, size);
      y -= size + 3;
    }
  };
  const heading = (t: string) => {
    y -= 8;
    text(t, L, 11, bold, rgb(0.1, 0.25, 0.5));
    y -= 4;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= 14;
  };

  text(m.fullName, L, 20, bold);
  y -= 18;
  text(`${m.location}  ·  ${m.email}  ·  ${m.phone}`, L, 9.5);
  y -= 13;
  text(`linkedin.com/in/morgan-lee-demo  ·  github.com/morganlee-demo`, L, 9.5);
  y -= 6;

  heading("PROFESSIONAL SUMMARY");
  wrap(m.summary, L, 10, W);

  heading("WORK EXPERIENCE");
  for (const e of m.experience) {
    text(e.title, L, 10.5, bold);
    right(`${e.start} – ${e.end}`, 10);
    y -= 13;
    text(`${e.company} — ${e.city}`, L, 10, font, rgb(0.3, 0.3, 0.3));
    y -= 14;
    for (const b of e.bullets) {
      text("•", L + 4, 10);
      wrap(b, L + 16, 10, W - 16);
    }
    y -= 6;
  }

  heading("EDUCATION");
  for (const e of m.education) {
    text(e.degree, L, 10.5, bold);
    right(`${e.start} – ${e.end}`, 10);
    y -= 13;
    text(e.institution, L, 10);
    y -= 14;
  }

  heading("SKILLS");
  text(`Technical: ${m.technicalSkills.join(", ")}`, L, 10);
  y -= 14;
  text(`Soft skills: ${m.softSkills.join(", ")}`, L, 10);
  return doc.save();
}
