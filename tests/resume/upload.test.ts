import { describe, expect, it } from "vitest";

import { MAX_RESUME_BYTES, validateResumeBytes, validateResumeMeta } from "~/lib/resume/validate";
import { handleResumeUpload, resumeKey } from "~/server/resume/upload";
import { getStorage } from "~/server/storage";
import { MemoryStorage } from "~/server/storage/memory";
import { classifyS3Error } from "~/server/storage/s3";
import { StorageError, type ObjectStorage } from "~/server/storage/types";
import { fileFrom, makeDocx, makePdf } from "../helpers/resume-fixtures";

const USER = "11111111-2222-3333-4444-555555555555";

describe("validateResumeMeta", () => {
  it.each([
    [{ name: "cv.pdf", size: 10 }, { ok: true, kind: "pdf" }],
    [{ name: "CV.DOCX", size: 10 }, { ok: true, kind: "docx" }],
    [{ name: "cv.doc", size: 10 }, { ok: false, error: "bad_extension" }],
    [{ name: "cv", size: 10 }, { ok: false, error: "bad_extension" }],
    [{ name: "cv.pdf", size: 0 }, { ok: false, error: "empty" }],
    [{ name: "cv.pdf", size: MAX_RESUME_BYTES + 1 }, { ok: false, error: "too_large" }],
    [null, { ok: false, error: "missing" }],
  ])("%j -> %j", (input, expected) => {
    expect(validateResumeMeta(input)).toEqual(expected);
  });
});

describe("validateResumeBytes (content sniffing)", () => {
  it("accepts a real PDF and DOCX", async () => {
    expect(validateResumeBytes("a.pdf", await makePdf())).toMatchObject({ ok: true, kind: "pdf" });
    expect(validateResumeBytes("a.docx", await makeDocx())).toMatchObject({ ok: true, kind: "docx" });
  });
  it("rejects a renamed text file and a non-Word zip", async () => {
    expect(validateResumeBytes("a.pdf", new TextEncoder().encode("hello"))).toEqual({ ok: false, error: "bad_content" });
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("xl/workbook.xml")]);
    expect(validateResumeBytes("a.docx", zip)).toEqual({ ok: false, error: "bad_content" });
  });
  it("rejects a PDF renamed to .docx", async () => {
    expect(validateResumeBytes("a.docx", await makePdf())).toEqual({ ok: false, error: "bad_content" });
  });
});

describe("handleResumeUpload", () => {
  it("stores a valid PDF under the user's prefix", async () => {
    const storage = new MemoryStorage();
    const pdf = await makePdf();
    const res = await handleResumeUpload({ userId: USER, file: fileFrom(pdf, "resume.pdf"), storage });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.path).toMatch(new RegExp(`^${USER}/resumes/[0-9a-f-]{36}\\.pdf$`));
    const stored = storage.objects.get(res.body.path)!;
    expect(stored.contentType).toBe("application/pdf");
    expect(stored.body.byteLength).toBe(pdf.byteLength);
  });

  it("rejects anonymous uploads before reading the file", async () => {
    const storage = new MemoryStorage();
    const res = await handleResumeUpload({ userId: null, file: fileFrom(await makePdf(), "r.pdf"), storage });
    expect(res.status).toBe(401);
    expect(storage.objects.size).toBe(0);
  });

  it("returns 400 for missing / invalid files and stores nothing", async () => {
    const storage = new MemoryStorage();
    for (const file of [null, "not a file", fileFrom(new Uint8Array([1, 2, 3]), "r.pdf")]) {
      const res = await handleResumeUpload({ userId: USER, file, storage });
      expect(res.status).toBe(400);
    }
    expect(storage.objects.size).toBe(0);
  });

  it("maps storage failures to safe responses without leaking details", async () => {
    const failing = (code: StorageError["code"]): ObjectStorage => ({
      driver: "memory",
      put: async () => {
        throw new StorageError("secret-ish internal detail", code);
      },
      get: async () => null,
      delete: async () => undefined,
    });
    const file = fileFrom(await makePdf(), "r.pdf");
    const config = await handleResumeUpload({ userId: USER, file, storage: failing("config") });
    expect(config).toMatchObject({ status: 500, body: { code: "storage_config" } });
    expect(JSON.stringify(config.body)).not.toContain("secret-ish");
    const busy = await handleResumeUpload({ userId: USER, file, storage: failing("unavailable") });
    expect(busy.status).toBe(503);
  });
});

describe("resumeKey", () => {
  it("rejects path traversal in user ids", () => {
    expect(() => resumeKey("../other", "pdf")).toThrow();
    expect(() => resumeKey("a/b", "pdf")).toThrow();
  });
});

describe("classifyS3Error", () => {
  it.each([
    ["SignatureDoesNotMatch", "config"],
    ["NoSuchBucket", "config"],
    ["InvalidAccessKeyId", "auth"],
    ["NoSuchKey", "not_found"],
    ["SlowDown", "unavailable"],
    ["Weird", "unknown"],
  ])("%s -> %s", (name, code) => {
    const err = Object.assign(new Error("x"), { name });
    expect(classifyS3Error(err).code).toBe(code);
  });
});

describe("getStorage", () => {
  it("defaults to memory outside production", () => {
    expect(getStorage({ NODE_ENV: "development" } as NodeJS.ProcessEnv).driver).toBe("memory");
  });
  it("refuses memory storage in production", () => {
    expect(() => getStorage({ NODE_ENV: "production", STORAGE_DRIVER: "memory" } as NodeJS.ProcessEnv)).toThrow(StorageError);
  });
  it("names missing S3 vars without echoing values", () => {
    try {
      getStorage({ NODE_ENV: "production", BUCKET_NAME: "b" } as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("BUCKET_REGION");
      expect((e as Error).message).not.toContain("BUCKET_NAME");
    }
  });
  it("builds S3 storage when fully configured (no network call)", () => {
    const s = getStorage({
      NODE_ENV: "production",
      BUCKET_S3_ENDPOINT: "https://ref.storage.supabase.co/storage/v1/s3",
      BUCKET_REGION: "ap-southeast-1",
      BUCKET_NAME: "b",
      BUCKET_ACCESS_KEY: "k",
      BUCKET_SECRET_KEY: "s",
    } as NodeJS.ProcessEnv);
    expect(s.driver).toBe("s3");
  });
});
