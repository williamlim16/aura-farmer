/**
 * LOCAL-ONLY stand-in for Supabase Auth, for development and integration tests
 * while the team's Supabase project is not accessible.
 *
 * It does NOT bypass anything in the app: the team's unmodified middleware and
 * @supabase/ssr verify our ES256 session JWT exactly as they verify a real one,
 * by fetching this server's JWKS. It only works when the app process is started
 * with NEXT_PUBLIC_SUPABASE_URL pointing here (done by `pnpm dev:stack` and the
 * e2e tests). A deployed app points at real Supabase, which will never accept
 * tokens signed by the throwaway key generated here on every start.
 *
 * Guards: refuses NODE_ENV=production, binds 127.0.0.1, synthetic users only.
 */
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

export interface MockUser {
  id: string;
  email: string;
}

export const SYNTHETIC_USERS: MockUser[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "avery.quinn@example.com" },
  { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "blake.demo@example.com" },
];

export async function startMockAuth(opts: { port?: number; appUrl?: string } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("Mock auth must never run in production.");
  const kid = `mock-${crypto.randomUUID()}`;
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid, alg: "ES256", use: "sig" };
  let baseUrl = "";

  async function signJwt(payload: Record<string, unknown>) {
    const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
    return `${header}.${body}.${b64url(sig)}`;
  }

  async function verify(token: string): Promise<Record<string, unknown> | null> {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
    return Number(payload.exp) * 1000 > Date.now() ? payload : null;
  }

  /** Session in the shape @supabase/ssr stores in its cookie. */
  async function mintSession(user: MockUser, ttlSec = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = await signJwt({
      iss: `${baseUrl}/auth/v1`,
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      iat: now,
      exp: now + ttlSec,
      session_id: crypto.randomUUID(),
      is_anonymous: false,
    });
    const userObj = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
    return { access_token, refresh_token: `mock-refresh-${crypto.randomUUID()}`, token_type: "bearer", expires_in: ttlSec, expires_at: now + ttlSec, user: userObj };
  }

  /** Cookie name/value that @supabase/ssr reads for a Supabase URL on host `localhost`. */
  async function sessionCookie(user: MockUser) {
    const host = new URL(baseUrl).hostname.split(".")[0];
    return { name: `sb-${host}-auth-token`, value: `base64-${b64url(JSON.stringify(await mintSession(user)))}` };
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", baseUrl);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return json(200, { keys: [publicJwk] });
      if (url.pathname === "/auth/v1/user") {
        const claims = await verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
        if (!claims) return json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        const user = SYNTHETIC_USERS.find((u) => u.id === claims.sub);
        return json(200, { id: claims.sub, aud: "authenticated", role: "authenticated", email: user?.email ?? claims.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      }
      if (url.pathname === "/auth/v1/logout") {
        res.writeHead(204).end();
        return;
      }
      // Dev convenience: sign in as a synthetic user (cookies on "localhost" are shared across ports).
      if (url.pathname === "/dev-login" && req.method === "GET") {
        const who = SYNTHETIC_USERS.find((u) => u.id === url.searchParams.get("user"));
        if (who && opts.appUrl) {
          const c = await sessionCookie(who);
          res.writeHead(302, { "set-cookie": `${c.name}=${c.value}; Path=/; SameSite=Lax; HttpOnly`, location: `${opts.appUrl}/apply` });
          return res.end();
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Mock sign-in (local only)</title>
<body style="font-family:system-ui;max-width:560px;margin:48px auto">
<h1>Local mock sign-in</h1><p style="background:#fef3c7;padding:8px">Development only. Synthetic users. Real Supabase auth is not used.</p>
${SYNTHETIC_USERS.map((u) => `<p><a href="/dev-login?user=${u.id}">Sign in as ${u.email}</a></p>`).join("")}</body>`);
      }
      json(404, { error: "not found" });
    })().catch(() => {
      res.writeHead(500).end();
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { url: baseUrl, sessionCookie, mintSession, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  void startMockAuth({ port: Number(process.env.MOCK_AUTH_PORT ?? 54321), appUrl: process.env.APP_URL ?? "http://localhost:3000" }).then((a) => {
    console.log(`[mock-auth] ${a.url} (sign in: ${a.url}/dev-login)`);
  });
}
