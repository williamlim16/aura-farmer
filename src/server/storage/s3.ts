import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { StorageError, type ObjectStorage } from "./types";

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Map S3 errors to actionable codes. SignatureDoesNotMatch from Supabase almost
 * always means the region does not match the project's region, or the key pair
 * is from another project; it is reported as a config problem, not a 500 mystery.
 */
export function classifyS3Error(err: unknown): StorageError {
  const name = err instanceof S3ServiceException ? err.name : (err as Error)?.name;
  const msg = (err as Error)?.message ?? "storage error";
  switch (name) {
    case "SignatureDoesNotMatch":
      return new StorageError(
        "Storage signature mismatch: check BUCKET_REGION matches the Supabase project region and the S3 key pair belongs to this project.",
        "config",
        err,
      );
    case "InvalidAccessKeyId":
    case "AccessDenied":
    case "Forbidden":
      return new StorageError("Storage credentials rejected.", "auth", err);
    case "NoSuchBucket":
      return new StorageError("Storage bucket not found: check BUCKET_NAME.", "config", err);
    case "NoSuchKey":
    case "NotFound":
      return new StorageError("Object not found.", "not_found", err);
    case "TimeoutError":
    case "ServiceUnavailable":
    case "SlowDown":
      return new StorageError("Storage temporarily unavailable.", "unavailable", err);
    default:
      return new StorageError(msg, "unknown", err);
  }
}

export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig, client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: true,
        maxAttempts: 3,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  /** Read-only connectivity check: bucket reachable and listable with these credentials. Writes nothing. */
  async check(): Promise<{ ok: true; sampleKeyCount: number } | { ok: false; error: StorageError }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (err) {
      // HEAD responses have no body, so the SDK cannot name the error; use the status.
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return { ok: false, error: new StorageError("Storage bucket not found: check BUCKET_NAME.", "config", err) };
      if (status === 403 || status === 400) return { ok: false, error: new StorageError("Storage request rejected: check BUCKET_REGION matches the project region and the S3 key pair belongs to this project.", "config", err) };
      return { ok: false, error: classifyS3Error(err) };
    }
    try {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, MaxKeys: 1 }));
      return { ok: true, sampleKeyCount: r.KeyCount ?? 0 };
    } catch (err) {
      return { ok: false, error: classifyS3Error(err) };
    }
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    } catch (err) {
      throw classifyS3Error(err);
    }
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      const e = classifyS3Error(err);
      if (e.code === "not_found") return null;
      throw e;
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (err) {
      throw classifyS3Error(err);
    }
  }
}
