import { describe, expect, it } from "vitest";

import { guardDecision } from "~/lib/apply/decision/engine";
import { applyUrlFor, resolveApplication } from "~/server/apply-real/resolve";
import { issueReviewToken, readReviewToken } from "~/server/apply-real/state";

const SECRET = "s".repeat(40);

describe("application URL resolution", () => {
  it("maps Greenhouse and Lever postings to their application pages without fetching", () => {
    expect(applyUrlFor("https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123")).toMatchObject({ ats: "greenhouse", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123" });
    expect(applyUrlFor("https://jobs.lever.co/acme/0f8fad5b-d9cb-469f-a165-70867728950e")).toMatchObject({ ats: "lever", applyUrl: "https://jobs.lever.co/acme/0f8fad5b-d9cb-469f-a165-70867728950e/apply" });
    expect(applyUrlFor("https://job-boards.greenhouse.io/acme/jobs/../../x")).toBeNull();
  });
  it("refuses non-https, credentials, ports and private or internal hosts", async () => {
    for (const u of ["http://example.com/job", "https://user:pw@example.com/", "https://example.com:8443/", "https://127.0.0.1/", "https://localhost/job", "https://169.254.169.254/latest", "https://metadata.internal/", "file:///etc/passwd"]) {
      await expect(resolveApplication(u)).rejects.toThrow();
    }
  });
});

describe("review token", () => {
  const state = { applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1", resumeSha: "a", profileSha: "b", fields: [{ step: 1, label: "Email", outcome: "verified", value: "x@example.com", required: true }] };
  it("round-trips and rejects tampering, other secrets and expiry", () => {
    const now = Date.now();
    const t = issueReviewToken(state, SECRET, now);
    expect(readReviewToken(t, SECRET, now)?.fields[0]?.value).toBe("x@example.com");
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(Buffer.from(payload!, "base64url").toString().replace("x@example.com", "evil@example.com")).toString("base64url");
    expect(readReviewToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(readReviewToken(t, "o".repeat(40), now)).toBeNull();
    expect(readReviewToken(t, SECRET, now + 31 * 60 * 1000)).toBeNull();
  });
});

describe("safety guard with explicit user answers", () => {
  const field = { id: "f", label: "Gender", control: "select", options: [] } as never;
  it("lets only a rule-tier, user-provided answer fill an EEO/consent field", () => {
    const eeo = { kind: "eeo" } as never;
    expect(guardDecision(eeo, { action: "fill", value: "Decline", tier: "rule", confidence: 1, userProvided: true }, field).action).toBe("fill");
    expect(guardDecision(eeo, { action: "fill", value: "Decline", tier: "rule", confidence: 1 }, field).action).toBe("human");
    expect(guardDecision(eeo, { action: "fill", value: "Decline", tier: "llm", confidence: 1, userProvided: true }, field).action).toBe("human");
  });
});

import { isAtsResumeUpload } from "~/server/apply-real/run-real";

describe("resume upload allowance", () => {
  const up = (url: string, o: Partial<{ method: string; resourceType: string; contentType: string }> = {}) => isAtsResumeUpload({ method: "POST", resourceType: "xhr", contentType: "multipart/form-data; boundary=x", url, ...o });
  it("allows only Greenhouse's own bucket multipart upload", () => {
    expect(up("https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/")).toBe(true);
    expect(up("https://grnhse-prod-jben-us-west-2.s3.us-west-2.amazonaws.com/")).toBe(true);
    for (const bad of ["https://evil.s3.amazonaws.com/", "https://grnhse-x.s3.amazonaws.com.evil.com/", "http://grnhse-x.s3.amazonaws.com/", "https://grnhse-x.s3.amazonaws.com/other", "https://job-boards.greenhouse.io/applications"]) expect(up(bad)).toBe(false);
    expect(up("https://grnhse-x.s3.amazonaws.com/", { contentType: "application/json" })).toBe(false);
    expect(up("https://grnhse-x.s3.amazonaws.com/", { method: "PUT" })).toBe(false);
    expect(up("https://grnhse-x.s3.amazonaws.com/", { resourceType: "document" })).toBe(false);
  });
});
