/**
 * One real round trip against the configured S3 bucket: upload a SYNTHETIC
 * PDF under local-smoke/, read it back, compare bytes, delete it.
 * Writes to the shared bucket, so it refuses to run without --yes-write.
 *
 *   STORAGE_DRIVER=s3 BUCKET_...=... npx tsx scripts/s3-upload-smoke.ts --yes-write
 */
import { getStorage } from "~/server/storage/select";
import { S3Storage } from "~/server/storage/s3";
import { makePdf } from "../tests/helpers/resume-fixtures";

if (!process.argv.includes("--yes-write")) {
  console.error("This writes (then deletes) one synthetic object in the shared bucket. Re-run with --yes-write after approval.");
  process.exit(2);
}
// --yes-write is the deliberate opt-in for this one run.
const storage = getStorage({ ...process.env, STORAGE_DRIVER: "s3", ALLOW_DEV_S3: "1", NODE_ENV: "development" });
if (!(storage instanceof S3Storage)) throw new Error("STORAGE_DRIVER=s3 is required.");
const pre = await storage.check();
if (!pre.ok) throw pre.error;
const key = `local-smoke/${crypto.randomUUID()}.pdf`;
const bytes = await makePdf();
await storage.put(key, bytes, "application/pdf");
const back = await storage.get(key);
const same = !!back && back.byteLength === bytes.byteLength && back.every((b, i) => b === bytes[i]);
await storage.delete(key);
const gone = (await storage.get(key)) === null;
console.log(JSON.stringify({ key, uploadedBytes: bytes.byteLength, readBackIdentical: same, deleted: gone }));
process.exit(same && gone ? 0 : 1);
