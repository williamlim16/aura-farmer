import { type ObjectStorage } from "./types";

/** In-process storage for tests and local development without Supabase. */
export class MemoryStorage implements ObjectStorage {
  readonly driver = "memory" as const;
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body: new Uint8Array(body), contentType });
  }

  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
