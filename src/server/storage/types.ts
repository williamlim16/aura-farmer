/** Object storage used for resumes. Implementations: S3 (Supabase), memory (tests/dev). */
export interface ObjectStorage {
  readonly driver: "s3" | "memory" | "file";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Thrown for storage failures, with a classification the API can act on. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: "config" | "auth" | "not_found" | "unavailable" | "unknown",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
