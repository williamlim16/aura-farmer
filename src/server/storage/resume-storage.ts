import crypto from "node:crypto";

import { env } from "~/env";

export const RESUME_BUCKET = "aura-farmer-bucket";

const S3_REGION = "ap-southeast-1";
const S3_SERVICE = "s3";

function encodeS3PathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildObjectUrl(bucketId: string, storagePath: string): URL {
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const cleanKey = storagePath.replace(/^\/+/, "");
  const encodedKey = cleanKey.split("/").map(encodeS3PathSegment).join("/");
  return new URL(
    `${baseUrl}/storage/v1/s3/${encodeS3PathSegment(bucketId)}/${encodedKey}`,
  );
}

function hmacSha256(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function signS3Request(params: {
  method: "GET" | "PUT" | "DELETE";
  url: URL;
  payload?: Uint8Array;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.payload ?? "");

  const canonicalHeaders =
    `host:${params.url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalQuery = params.url.search.startsWith("?")
    ? params.url.search.slice(1)
    : "";

  const canonicalRequest = [
    params.method,
    params.url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${S3_REGION}/${S3_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${env.BUCKET_SECRET_KEY}`, dateStamp);
  const kRegion = hmacSha256(kDate, S3_REGION);
  const kService = hmacSha256(kRegion, S3_SERVICE);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${env.BUCKET_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Uploads a resume file buffer to Supabase Storage via the S3-compatible endpoint. */
export async function uploadResumeObject(params: {
  bucketId?: string;
  storagePath: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  const bucketId = params.bucketId ?? RESUME_BUCKET;
  const url = buildObjectUrl(bucketId, params.storagePath);
  const bytes = new Uint8Array(params.body);
  const signedHeaders = signS3Request({
    method: "PUT",
    url,
    payload: bytes,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...signedHeaders,
      "Content-Type": params.contentType,
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Supabase Storage upload failed (${response.status}): ${details || response.statusText}`,
    );
  }
}

/** Downloads a resume object from Supabase Storage as an ArrayBuffer. */
export async function downloadResumeObject(params: {
  bucketId?: string;
  storagePath: string;
}): Promise<ArrayBuffer> {
  const bucketId = params.bucketId ?? RESUME_BUCKET;
  const url = buildObjectUrl(bucketId, params.storagePath);
  const signedHeaders = signS3Request({
    method: "GET",
    url,
  });

  const response = await fetch(url, {
    method: "GET",
    headers: signedHeaders,
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Supabase Storage download failed (${response.status}): ${details || response.statusText}`,
    );
  }

  return await response.arrayBuffer();
}

/** Deletes a resume object from Supabase Storage, treating missing objects as already deleted. */
export async function deleteResumeObject(params: {
  bucketId?: string;
  storagePath: string;
}): Promise<void> {
  const bucketId = params.bucketId ?? RESUME_BUCKET;
  const url = buildObjectUrl(bucketId, params.storagePath);
  const signedHeaders = signS3Request({
    method: "DELETE",
    url,
  });

  const response = await fetch(url, {
    method: "DELETE",
    headers: signedHeaders,
  });

  if (!response.ok && response.status !== 404) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Supabase Storage delete failed (${response.status}): ${details || response.statusText}`,
    );
  }
}
