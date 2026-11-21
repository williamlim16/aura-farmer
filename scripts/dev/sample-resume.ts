/** Writes the synthetic demo resume (fictional person) to ./demo-resume.pdf (or the path given). */
import fs from "node:fs";

import { makePdf } from "../../tests/helpers/resume-fixtures";

const out = process.argv[2] ?? "demo-resume.pdf";
fs.writeFileSync(out, await makePdf());
console.log(`Wrote synthetic resume to ${out}`);
