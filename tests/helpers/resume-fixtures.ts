/**
 * Synthetic resumes generated at test time. All people, companies and contact
 * details are fictional (example.com / 555 numbers).
 */
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const SAMPLE_RESUME_LINES = [
  "Avery Quinn",
  "Melbourne, VIC, Australia",
  "avery.quinn@example.com | +61 400 555 123",
  "linkedin.com/in/avery-quinn-demo | github.com/averyq-demo | https://averyquinn.example.com",
  "",
  "SUMMARY",
  "Full-stack engineer with 6 years of experience building TypeScript web platforms.",
  "",
  "EXPERIENCE",
  "Senior Software Engineer, Northwind Labs",
  "Mar 2021 - Present",
  "- Led migration of a Next.js storefront serving 2M monthly users.",
  "- Built Playwright test suites that cut regressions by 40%.",
  "Software Engineer, Contoso Analytics",
  "Jan 2019 - Feb 2021",
  "- Developed data ingestion services in Node.js and PostgreSQL.",
  "",
  "EDUCATION",
  "Bachelor of Computer Science, University of Melbourne",
  "2015 - 2018",
  "",
  "SKILLS",
  "TypeScript, React, Next.js, Node.js, PostgreSQL, Playwright, AWS, Docker",
];

export async function makePdf(lines: string[] = SAMPLE_RESUME_LINES): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 50) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 16;
  }
  return doc.save();
}

export async function makeDocx(lines: string[] = SAMPLE_RESUME_LINES): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: lines.map((text) =>
          /^[A-Z ]{4,}$/.test(text)
            ? new Paragraph({ text, heading: HeadingLevel.HEADING_2 })
            : new Paragraph({ text }),
        ),
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export function fileFrom(bytes: Uint8Array, name: string, type = ""): File {
  return new File([new Uint8Array(bytes)], name, { type });
}
