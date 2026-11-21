import fs from "node:fs/promises";
import path from "node:path";

import { StorageError, type ObjectStorage } from "./types";

const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Local-disk storage so the Next.js app and a separate browser-worker process
 * can share uploaded resumes during development. Refused in production by
 * getStorage(). Keys are validated segment by segment: no traversal.
 */
export class FileStorage implements ObjectStorage {
  readonly driver = "file" as const;
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const parts = key.split("/");
    if (!parts.length || parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) {
      throw new StorageError("Invalid object key.", "config");
    }
    const full = path.resolve(this.root, ...parts);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new StorageError("Invalid object key.", "config");
    return full;
  }

  async put(key: string, body: Uint8Array, _contentType?: string) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.resolve(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}
