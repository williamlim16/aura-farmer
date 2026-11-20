import "server-only";

import path from "node:path";

import { FileStorage } from "./file";
import { MemoryStorage } from "./memory";
import { S3Storage } from "./s3";
import { StorageError, type ObjectStorage } from "./types";

export { StorageError, type ObjectStorage } from "./types";

const REQUIRED_S3_VARS = [
  "BUCKET_S3_ENDPOINT",
  "BUCKET_REGION",
  "BUCKET_NAME",
  "BUCKET_ACCESS_KEY",
  "BUCKET_SECRET_KEY",
] as const;

let memorySingleton: MemoryStorage | undefined;

/**
 * STORAGE_DRIVER=memory (default outside production) keeps uploads in process,
 * so the upload flow can be developed without Supabase credentials.
 * STORAGE_DRIVER=file (dev only) shares uploads with a separate worker process.
 * STORAGE_DRIVER=s3 uses the Supabase S3-compatible endpoint.
 */
export function getStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? (env.NODE_ENV === "production" ? "s3" : "memory");
  if (driver === "memory") {
    if (env.NODE_ENV === "production") {
      throw new StorageError("Memory storage is not allowed in production.", "config");
    }
    return (memorySingleton ??= new MemoryStorage());
  }
  if (driver === "file") {
    if (env.NODE_ENV === "production") {
      throw new StorageError("File storage is not allowed in production.", "config");
    }
    return new FileStorage(path.resolve(env.FILE_STORAGE_DIR ?? ".data/storage"));
  }
  if (driver !== "s3") throw new StorageError(`Unknown STORAGE_DRIVER "${driver}".`, "config");
  const missing = REQUIRED_S3_VARS.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new StorageError(`Missing storage env vars: ${missing.join(", ")}`, "config");
  }
  return new S3Storage({
    endpoint: env.BUCKET_S3_ENDPOINT!.trim(),
    region: env.BUCKET_REGION!.trim(),
    bucket: env.BUCKET_NAME!.trim(),
    accessKeyId: env.BUCKET_ACCESS_KEY!.trim(),
    secretAccessKey: env.BUCKET_SECRET_KEY!.trim(),
  });
}
