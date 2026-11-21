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
 * STORAGE_DRIVER=s3 uses the Supabase S3-compatible endpoint (outside
 * production it also requires ALLOW_DEV_S3=1, because it is the shared bucket).
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
  // Outside production the S3 bucket is the team's shared bucket: require a deliberate opt-in.
  if (env.NODE_ENV !== "production" && env.ALLOW_DEV_S3 !== "1") {
    throw new StorageError("S3 storage outside production is opt-in: set ALLOW_DEV_S3=1 together with STORAGE_DRIVER=s3 (see docs/LOCAL_SETUP.md), or use STORAGE_DRIVER=file for local development.", "config");
  }
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
