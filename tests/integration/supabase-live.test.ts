/**
 * LIVE Supabase Auth check. Skipped unless SUPABASE_LIVE_TEST=1 and a
 * dedicated test user exist. Read-only: signs in, verifies the session token
 * with getClaims (JWKS, as our middleware does), signs out. Writes no app data.
 *
 *   SUPABASE_LIVE_TEST=1 NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
 *   SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... npx vitest run tests/integration/supabase-live.test.ts
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const live = process.env.SUPABASE_LIVE_TEST === "1";

describe.skipIf(!live)("Supabase Auth (live, read-only)", () => {
  it("signs in a test user and verifies the token like the middleware does", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.signInWithPassword({ email: process.env.SUPABASE_TEST_EMAIL!, password: process.env.SUPABASE_TEST_PASSWORD! });
    expect(error).toBeNull();
    const claims = await supabase.auth.getClaims(data.session!.access_token);
    expect(claims.error).toBeNull();
    expect(claims.data?.claims.sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.data?.claims.role).toBe("authenticated");
    await supabase.auth.signOut();
  });
});
