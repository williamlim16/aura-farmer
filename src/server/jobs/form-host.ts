/**
 * Loopback-only HTTP host for the allow-listed synthetic test forms, owned by
 * the worker. The browser's egress allowlist is exactly this origin, so a job
 * can never reach the internet. Any POST that arrives (a submission that
 * escaped the guard) is counted and surfaced in the job log.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { APPLICATION_TARGETS } from "~/lib/applications/targets";

export interface FormHost {
  origin: string;
  urlFor(file: string): string;
  submissions(): number;
  close(): Promise<void>;
}

export const TEST_FORMS_DIR = path.resolve(process.cwd(), "test-forms");

export async function startFormHost(dir = TEST_FORMS_DIR, extraFiles: string[] = []): Promise<FormHost> {
  const allowed = new Set([...APPLICATION_TARGETS.map((t) => t.file), ...extraFiles]);
  let posts = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      posts++;
      req.resume();
      res.writeHead(403).end("Submissions are disabled.");
      return;
    }
    const name = path.basename(new URL(req.url ?? "/", "http://x").pathname);
    if (!allowed.has(name)) {
      res.writeHead(404).end();
      return;
    }
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(p));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    urlFor: (file) => `${origin}/${encodeURIComponent(file)}`,
    submissions: () => posts,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
