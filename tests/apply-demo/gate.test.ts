import { describe, expect, it } from "vitest";

import { issueDemoToken, verifyDemoToken } from "~/server/apply-demo/demo-token";
import { applyDemoEnabled, isApplyDemoPath } from "~/server/apply-demo/gate";
import { demoPersona } from "~/server/apply-demo/personas";

const SECRET = "x".repeat(40);

describe("apply demo gate", () => {
  it("is off unless enabled with a secret, and never on production", () => {
    expect(applyDemoEnabled({})).toBe(false);
    expect(applyDemoEnabled({ APPLY_DEMO_ENABLED: "1" })).toBe(false);
    expect(applyDemoEnabled({ APPLY_DEMO_ENABLED: "1", APPLY_DEMO_SECRET: "short" })).toBe(false);
    expect(applyDemoEnabled({ APPLY_DEMO_ENABLED: "1", APPLY_DEMO_SECRET: SECRET, VERCEL_ENV: "production" })).toBe(false);
    expect(applyDemoEnabled({ APPLY_DEMO_ENABLED: "1", APPLY_DEMO_SECRET: SECRET, VERCEL_ENV: "preview" })).toBe(true);
  });
  it("bypasses login for the two exact paths only", () => {
    expect(isApplyDemoPath("/apply-demo")).toBe(true);
    expect(isApplyDemoPath("/api/apply-demo/run")).toBe(true);
    for (const p of ["/apply-demo/", "/apply-demo/x", "/apply", "/api/apply-demo", "/api/apply-demo/run/x", "/profile", "/api/profile", "/jobs"]) expect(isApplyDemoPath(p)).toBe(false);
  });
});

describe("apply demo token", () => {
  it("accepts a fresh token and rejects tampered, expired or foreign ones", () => {
    const now = Date.now();
    const t = issueDemoToken(SECRET, now);
    expect(verifyDemoToken(t, SECRET, now)).toBe(true);
    expect(verifyDemoToken(t, "y".repeat(40), now)).toBe(false);
    expect(verifyDemoToken(t, SECRET, now + 31 * 60 * 1000)).toBe(false);
    expect(verifyDemoToken(`${Number(t.split(".")[0]) + 1}.${t.split(".")[1]}`, SECRET, now)).toBe(false);
    expect(verifyDemoToken(undefined, SECRET, now)).toBe(false);
  });
});

describe("apply demo personas", () => {
  it("only serves the fictional personas", () => {
    expect(demoPersona("alex-rivera")?.profile.contact.email?.value).toBe("alex.rivera@example.com");
    expect(demoPersona("someone-else")).toBeNull();
    expect(demoPersona("__proto__")).toBeNull();
  });
});
