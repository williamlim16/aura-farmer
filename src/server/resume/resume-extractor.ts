import crypto from "node:crypto";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { env } from "~/env";

export const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-micro-v1:0";

const COST_EFFECTIVE_BEDROCK_MODELS = [
  "amazon.nova-micro-v1:0",
  "apac.amazon.nova-micro-v1:0",
  "amazon.nova-lite-v1:0",
  "apac.amazon.nova-lite-v1:0",
] as const;

export interface ExtractedProfileFields {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  phone: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  summary: string | null;
  skills: string | null;
}

export interface ExtractedExperienceEntry {
  jobTitle: string;
  company: string;
  employmentType: string | null;
  location: string | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface ExtractedEducationEntry {
  school: string;
  degree: string;
  fieldOfStudy: string | null;
  location: string | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  grade: string | null;
  description: string | null;
}

export interface ExtractedResumeData {
  profile: ExtractedProfileFields;
  experiences: ExtractedExperienceEntry[];
  educations: ExtractedEducationEntry[];
  pagesProcessed: number;
  modelUsed: string;
}

interface BedrockConverseResponse {
  output?: {
    message?: {
      content?: Array<{
        text?: string;
      }>;
    };
  };
  message?: string;
  Message?: string;
}

interface TextractResponse {
  Blocks?: Array<{
    BlockType?: string;
    Text?: string;
  }>;
  __type?: string;
  Message?: string;
  message?: string;
}

type ResumeSectionKey =
  | "summary"
  | "skills"
  | "experience"
  | "education"
  | "projects"
  | "certifications"
  | "volunteer"
  | "other";

const MAX_TEXTRACT_PAGES = 10;

const KEEP_HYPHEN_PREFIXES = new Set([
  "age",
  "anti",
  "back",
  "bio",
  "cloud",
  "co",
  "cross",
  "data",
  "e",
  "end",
  "evidence",
  "front",
  "full",
  "geo",
  "high",
  "i/o",
  "low",
  "macro",
  "micro",
  "multi",
  "non",
  "one",
  "open",
  "peer",
  "post",
  "pre",
  "re",
  "real",
  "self",
  "semi",
  "server",
  "sit",
  "space",
  "sub",
  "systems",
  "three",
  "time",
  "two",
  "user",
  "well",
  "zero",
]);

const KEEP_HYPHEN_SUFFIXES = new Set([
  "based",
  "bound",
  "by",
  "date",
  "day",
  "dimensional",
  "downtime",
  "driven",
  "end",
  "first",
  "for",
  "free",
  "friendly",
  "functional",
  "group",
  "heavy",
  "in",
  "level",
  "line",
  "of",
  "on",
  "only",
  "oriented",
  "out",
  "ready",
  "regression",
  "reviewed",
  "scale",
  "side",
  "stack",
  "term",
  "tested",
  "time",
  "to",
  "up",
  "volume",
  "year",
]);

const SKILL_CATEGORY_HEADER_PATTERNS: RegExp[] = [
  /^languages\s*(?:&|and)\s*core\s*systems$/i,
  /^programming\s+languages$/i,
  /^software\s+engineering\s*(?:&|and)\s*testing$/i,
  /^cloud\s*(?:&|and)\s*data\s*platforms$/i,
  /^scientific\s*(?:&|and)\s*data\s*modell?ing$/i,
  /^frameworks\s*(?:&|and)\s*(?:web|libraries)$/i,
  /^analytics\s*(?:&|and)\s*governance$/i,
  /^tools\s*(?:&|and)\s*(?:platforms|technologies)$/i,
  /^databases\s*(?:&|and)\s*storage$/i,
  /^core\s+competencies$/i,
  /^technical\s+skills$/i,
];

const SECTION_HEADER_PATTERNS: Array<{
  key: ResumeSectionKey;
  pattern: RegExp;
}> = [
  {
    key: "summary",
    pattern:
      /^(?:professional\s+)?(?:summary|profile|about(?:\s+me)?|objective|executive\s+summary|career\s+summary)$/i,
  },
  {
    key: "skills",
    pattern:
      /^(?:technical\s+|core\s+|key\s+)?(?:skills|competencies|technologies|tech\s+stack|skills\s*(?:&|and)\s*tools)$/i,
  },
  {
    key: "education",
    pattern:
      /^(?:education(?:\s*(?:&|and)\s*qualifications)?|academic\s+(?:background|history)|qualifications)$/i,
  },
  {
    key: "experience",
    pattern:
      /^(?:work\s+|professional\s+|relevant\s+)?(?:experience|experiences|employment(?:\s+history)?|career\s+history|work\s+history)$/i,
  },
  {
    key: "projects",
    pattern: /^(?:selected\s+|key\s+|personal\s+)?projects$/i,
  },
  {
    key: "certifications",
    pattern:
      /^(?:certifications?(?:\s*(?:&|and)\s*professional\s+development)?|licenses?(?:\s*(?:&|and)\s*certifications?)?)$/i,
  },
  {
    key: "volunteer",
    pattern:
      /^(?:volunteer(?:ing)?(?:\s+experiences?)?|community\s+(?:involvement|service))$/i,
  },
  {
    key: "other",
    pattern: /^(?:publications|awards|honors|honours|languages|interests|references)$/i,
  },
];

const MONTH_PATTERN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const DATE_RANGE_REGEX = new RegExp(
  `((?:${MONTH_PATTERN}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|(?:19|20)\\d{2}))\\s*(?:-|–|—|\\bto\\b)\\s*(Present|Current|Now|${MONTH_PATTERN}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|(?:19|20)\\d{2})`,
  "i",
);

const INSTITUTION_KEYWORD_REGEX =
  /\b(?:university|institute|college|school|academy|polytechnic|nusantara|mit|stanford|harvard|oxford|cambridge)\b/i;

const DEGREE_KEYWORD_REGEX =
  /\b(?:bachelor|master|phd|ph\.d\.|doctor(?:ate)?|associate|diploma|b\.?s\.?c?|m\.?s\.?c?|b\.?eng\.?|m\.?eng\.?|b\.?tech\.?|m\.?b\.?a\.?|certificate|honours|honors)\b/i;

const EMPLOYMENT_TYPE_REGEX =
  /\b(full[-\s]?time|part[-\s]?time|contract|internship|intern|freelance|casual)\b/i;

function hmacSha256(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function signAwsTextractRequest(params: {
  url: URL;
  payload: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.payload);

  const targetHeader = "Textract.DetectDocumentText";
  const contentType = "application/x-amz-json-1.1";

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${params.url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${targetHeader}\n`;
  const signedHeaders =
    "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target";

  const canonicalRequest = [
    "POST",
    params.url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/textract/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, "textract");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return {
    "content-type": contentType,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    "x-amz-target": targetHeader,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

class TextractRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "TextractRequestError";
    this.code = code;
  }
}

/** Calls Amazon Textract DetectDocumentText synchronously for a single-page PDF or image buffer. */
async function detectPdfPageTextWithTextract(
  pageBytes: Buffer,
): Promise<string[]> {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION ?? "ap-southeast-2";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials are missing. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
    );
  }

  const url = new URL(`https://textract.${region}.amazonaws.com/`);
  const payload = JSON.stringify({
    Document: { Bytes: pageBytes.toString("base64") },
  });

  const headers = signAwsTextractRequest({
    url,
    payload,
    region,
    accessKeyId,
    secretAccessKey,
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: payload,
  });

  const rawBody = await response.text();
  let parsed: TextractResponse = {};
  try {
    parsed = JSON.parse(rawBody) as TextractResponse;
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const errorType = parsed.__type?.split("#").pop();
    const errorMsg =
      parsed.Message ??
      parsed.message ??
      (rawBody || `AWS Textract HTTP ${response.status}`);
    throw new TextractRequestError(
      `AWS Textract failed (${errorType ?? response.status}): ${errorMsg}`,
      errorType,
    );
  }

  const lines: string[] = [];
  for (const block of parsed.Blocks ?? []) {
    if (block.BlockType === "LINE" && typeof block.Text === "string") {
      const normalized = normalizeExtractedLine(block.Text);
      if (normalized) {
        lines.push(normalized);
      }
    }
  }

  return lines;
}

function isFatalAwsAuthError(err: unknown): boolean {
  if (!(err instanceof TextractRequestError) || !err.code) {
    return false;
  }
  return [
    "AccessDeniedException",
    "UnrecognizedClientException",
    "InvalidSignatureException",
    "ExpiredTokenException",
    "SubscriptionRequiredException",
  ].includes(err.code);
}

function unescapePdfString(raw: string): string {
  return raw
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .trim();
}

function collectUrisFromText(text: string, target: Set<string>): void {
  const uriRegex = /\/URI\s*\(((?:\\.|[^\\()])+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = uriRegex.exec(text)) !== null) {
    const rawUri = match[1];
    if (!rawUri) continue;
    const cleaned = unescapePdfString(rawUri);
    if (cleaned) {
      target.add(cleaned);
    }
  }
}

/** Extracts hyperlink /URI(...) annotations from raw PDF bytes and FlateDecode object streams. */
function extractPdfAnnotationUris(buffer: Buffer): string[] {
  const raw = buffer.toString("latin1");
  const uris = new Set<string>();

  collectUrisFromText(raw, uris);

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(raw)) !== null) {
    const streamData = match[1];
    if (!streamData) continue;
    try {
      const inflated = zlib
        .inflateSync(Buffer.from(streamData, "latin1"))
        .toString("latin1");
      collectUrisFromText(inflated, uris);
    } catch {
      // Non-deflate streams (images, fonts, etc.) are expected and skipped.
    }
  }

  return Array.from(uris);
}

/** Fallback text extractor reading PDF text operators from compressed PDF streams if OCR cannot parse a page. */
function extractFallbackPdfLines(buffer: Buffer): string[] {
  const raw = buffer.toString("latin1");
  const lines: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(raw)) !== null) {
    const streamData = match[1];
    if (!streamData) continue;

    let decoded = streamData;
    try {
      decoded = zlib
        .inflateSync(Buffer.from(streamData, "latin1"))
        .toString("latin1");
    } catch {
      // Use raw stream if uncompressed.
    }

    if (!decoded.includes("Tj") && !decoded.includes("TJ")) {
      continue;
    }

    const tokens: string[] = [];
    const textRegex = /\((?:\\.|[^\\()])*\)/g;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = textRegex.exec(decoded)) !== null) {
      const inner = tokenMatch[0].slice(1, -1);
      const cleaned = unescapePdfString(inner).replace(/[^\x20-\x7E]/g, " ");
      if (cleaned) {
        tokens.push(cleaned);
      }
    }

    const joined = normalizeExtractedLine(tokens.join(" "));
    if (joined) {
      lines.push(joined);
    }
  }

  return lines;
}

async function extractPdfTextAndLinks(buffer: Buffer): Promise<{
  lines: string[];
  links: string[];
  pagesProcessed: number;
}> {
  const links = extractPdfAnnotationUris(buffer);

  try {
    const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const pagesToProcess = Math.max(1, Math.min(totalPages, MAX_TEXTRACT_PAGES));

    if (totalPages <= 1) {
      const lines = await detectPdfPageTextWithTextract(buffer);
      return { lines, links, pagesProcessed: 1 };
    }

    const pageBuffers = await Promise.all(
      Array.from({ length: pagesToProcess }, async (_, pageIndex) => {
        const singleDoc = await PDFDocument.create();
        const [copiedPage] = await singleDoc.copyPages(srcDoc, [pageIndex]);
        singleDoc.addPage(copiedPage);
        return Buffer.from(await singleDoc.save());
      }),
    );

    const pageLines = await Promise.all(
      pageBuffers.map((pageBuffer) => detectPdfPageTextWithTextract(pageBuffer)),
    );

    return {
      lines: pageLines.flat(),
      links,
      pagesProcessed: pagesToProcess,
    };
  } catch (err) {
    if (isFatalAwsAuthError(err)) {
      throw err;
    }

    // Attempt direct single-call Textract if pdf-lib failed to parse, otherwise fallback to stream text.
    try {
      const lines = await detectPdfPageTextWithTextract(buffer);
      return { lines, links, pagesProcessed: 1 };
    } catch (directErr) {
      if (isFatalAwsAuthError(directErr)) {
        throw directErr;
      }

      const fallbackLines = extractFallbackPdfLines(buffer);
      if (fallbackLines.length > 0) {
        return { lines: fallbackLines, links, pagesProcessed: 1 };
      }

      throw directErr instanceof Error ? directErr : new Error(String(err));
    }
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num: string) =>
      String.fromCharCode(Number.parseInt(num, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/** Reads stored/deflated ZIP entries from Central Directory so DOCX XML files can be parsed without external deps. */
function extractZipEntryMap(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return entries;
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (cursor + 46 > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const fileName = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLen)
      .toString("utf8");

    if (
      localHeaderOffset + 30 <= buffer.length &&
      buffer.readUInt32LE(localHeaderOffset) === 0x04034b50
    ) {
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedData = buffer.subarray(
        dataStart,
        dataStart + compressedSize,
      );

      if (compressionMethod === 0) {
        entries.set(fileName, compressedData);
      } else if (compressionMethod === 8) {
        try {
          entries.set(fileName, zlib.inflateRawSync(compressedData));
        } catch {
          // Ignore corrupted entry
        }
      }
    }

    cursor += 46 + fileNameLen + extraLen + commentLen;
  }

  return entries;
}

function extractDocxTextAndLinks(buffer: Buffer): {
  lines: string[];
  links: string[];
  pagesProcessed: number;
} {
  const entries = extractZipEntryMap(buffer);
  const docBuffer = entries.get("word/document.xml");
  if (!docBuffer) {
    throw new Error("Could not read document content from DOCX archive.");
  }

  const xml = docBuffer.toString("utf8");
  const lines: string[] = [];

  const paraRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let paraMatch: RegExpExecArray | null;
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const paraBody = paraMatch[1];
    if (!paraBody) continue;

    const withBreaks = paraBody
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<w:tab\b[^>]*\/>/g, " ");

    const fragments: string[] = [];
    const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(withBreaks)) !== null) {
      if (textMatch[1]) {
        fragments.push(decodeXmlEntities(textMatch[1]));
      }
    }

    const joined = fragments.join("");
    for (const subLine of joined.split(/\r?\n/)) {
      const normalized = normalizeExtractedLine(subLine);
      if (normalized) {
        lines.push(normalized);
      }
    }
  }

  const links: string[] = [];
  const relsBuffer = entries.get("word/_rels/document.xml.rels");
  if (relsBuffer) {
    const relsXml = relsBuffer.toString("utf8");
    const targetRegex = /Target="([^"]+)"/g;
    let targetMatch: RegExpExecArray | null;
    while ((targetMatch = targetRegex.exec(relsXml)) !== null) {
      const target = targetMatch[1];
      if (
        target &&
        (target.startsWith("http://") ||
          target.startsWith("https://") ||
          target.startsWith("mailto:") ||
          target.startsWith("tel:"))
      ) {
        links.push(decodeXmlEntities(target));
      }
    }
  }

  return { lines, links, pagesProcessed: 1 };
}

function extractLegacyDocTextAndLinks(buffer: Buffer): {
  lines: string[];
  links: string[];
  pagesProcessed: number;
} {
  const asciiText = buffer
    .toString("latin1")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "\n");
  const lines = asciiText
    .split(/\r?\n/)
    .map((line) => normalizeExtractedLine(line))
    .filter((line) => line.length >= 3 && /[a-zA-Z]{2,}/.test(line));

  const links: string[] = [];
  const urlMatches = asciiText.match(/https?:\/\/[^\s"'<>]+/g);
  if (urlMatches) {
    links.push(...urlMatches);
  }

  return { lines, links, pagesProcessed: 1 };
}

async function extractDocumentTextAndLinks(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<{ lines: string[]; links: string[]; pagesProcessed: number }> {
  const lowerName = params.fileName.toLowerCase();
  const mime = params.mimeType.toLowerCase();

  if (mime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return extractPdfTextAndLinks(params.buffer);
  }

  if (mime.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return extractDocxTextAndLinks(params.buffer);
  }

  if (mime === "application/msword" || lowerName.endsWith(".doc")) {
    return extractLegacyDocTextAndLinks(params.buffer);
  }

  throw new Error(
    "Unsupported resume file type. Please upload a PDF, DOC, or DOCX file.",
  );
}

function normalizeExtractedLine(raw: string): string {
  return raw
    .replace(/\u00A0/g, " ")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shouldKeepHyphenOnLineJoin(leftLine: string, rightLine: string): boolean {
  const leftMatch = /([A-Za-z0-9/]+)-$/.exec(leftLine);
  const rightMatch = /^([a-z]+)/.exec(rightLine);
  if (!leftMatch?.[1] || !rightMatch?.[1]) {
    return false;
  }

  const prefix = leftMatch[1].toLowerCase();
  const suffix = rightMatch[1].toLowerCase();
  return KEEP_HYPHEN_PREFIXES.has(prefix) || KEEP_HYPHEN_SUFFIXES.has(suffix);
}

/** Joins wrapped paragraph lines and heals line-break word hyphenation. */
function joinWrappedLines(lines: string[]): string {
  let result = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!result) {
      result = line;
      continue;
    }

    if (result.endsWith("-") && /^[a-z]/.test(line)) {
      if (shouldKeepHyphenOnLineJoin(result, line)) {
        result += line;
      } else {
        result = result.slice(0, -1) + line;
      }
    } else {
      result += ` ${line}`;
    }
  }

  return result.trim();
}

function matchSectionHeader(line: string): ResumeSectionKey | null {
  const cleaned = line
    .replace(/^[-•*▪‣\s]+/, "")
    .replace(/[:\-—]+$/, "")
    .trim();

  if (!cleaned || cleaned.length > 60) {
    return null;
  }

  for (const entry of SECTION_HEADER_PATTERNS) {
    if (entry.pattern.test(cleaned)) {
      return entry.key;
    }
  }

  return null;
}

function splitSections(lines: string[]): {
  headerLines: string[];
  sections: Record<ResumeSectionKey, string[]>;
} {
  const headerLines: string[] = [];
  const sections: Record<ResumeSectionKey, string[]> = {
    summary: [],
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    volunteer: [],
    other: [],
  };

  let currentSection: ResumeSectionKey | null = null;

  for (const line of lines) {
    const detected = matchSectionHeader(line);
    if (detected) {
      currentSection = detected;
      continue;
    }

    if (currentSection === null) {
      headerLines.push(line);
    } else {
      sections[currentSection].push(line);
    }
  }

  return { headerLines, sections };
}

function ensureHttpsUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;]+$/, "");
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function extractContactAndIdentity(params: {
  headerLines: string[];
  allLinks: string[];
}): {
  fullName: string | null;
  explicitHeadline: string | null;
  location: string | null;
  phone: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
} {
  const headerText = params.headerLines.join(" ");
  const normalizedHeaderLower = headerText.toLowerCase();

  let linkedinUrl: string | null = null;
  let githubUrl: string | null = null;
  let websiteUrl: string | null = null;
  let phone: string | null = null;

  // 1. Prefer rich hyperlink annotations that match header items (or LinkedIn/GitHub/tel links).
  const githubCandidates: string[] = [];
  for (const link of params.allLinks) {
    const lower = link.toLowerCase();
    if (lower.startsWith("tel:") && !phone) {
      const digits = link.slice(4).trim();
      if (digits.length >= 7) {
        phone = digits;
      }
      continue;
    }

    if (lower.startsWith("mailto:")) {
      continue;
    }

    const normalizedUrl = ensureHttpsUrl(link);
    if (!normalizedUrl) continue;

    if (lower.includes("linkedin.com/")) {
      linkedinUrl ??= normalizedUrl;
    } else if (lower.includes("github.com/")) {
      githubCandidates.push(normalizedUrl);
    } else {
      const host = new URL(normalizedUrl).hostname.replace(/^www\./, "").toLowerCase();
      if (normalizedHeaderLower.includes(host)) {
        websiteUrl ??= normalizedUrl;
      }
    }
  }

  // Pick shortest profile-level GitHub URL (avoid picking a project repo URL when profile URL exists).
  if (githubCandidates.length > 0) {
    githubCandidates.sort((a, b) => a.length - b.length);
    const profileLevel = githubCandidates.find((candidate) => {
      const pathname = new URL(candidate).pathname.replace(/^\/+|\/+$/g, "");
      return pathname.length > 0 && !pathname.includes("/");
    });
    githubUrl = profileLevel ?? githubCandidates[0] ?? null;
  }

  // 2. Extract URLs directly from visible header text.
  const linkedinMatch =
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_.-]+/i.exec(
      headerText,
    );
  if (!linkedinUrl && linkedinMatch?.[0]) {
    linkedinUrl = ensureHttpsUrl(linkedinMatch[0]);
  }

  const githubMatch =
    /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i.exec(headerText);
  if (!githubUrl && githubMatch?.[0]) {
    githubUrl = ensureHttpsUrl(githubMatch[0]);
  }

  const explicitHttpMatches = headerText.match(/https?:\/\/[^\s|,;]+/gi) ?? [];
  for (const rawUrl of explicitHttpMatches) {
    const lower = rawUrl.toLowerCase();
    if (lower.includes("linkedin.com") || lower.includes("github.com")) {
      continue;
    }
    const candidate = ensureHttpsUrl(rawUrl);
    if (candidate) {
      websiteUrl ??= candidate;
      break;
    }
  }

  // 3. Extract phone from visible header text if not already found via tel: annotation.
  if (!phone) {
    const strippedEmail = headerText.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      " ",
    );
    const phoneMatch = /(?:\+?\d[\d\s().-]{7,18}\d)/.exec(strippedEmail);
    if (phoneMatch?.[0]) {
      const digitsOnly = phoneMatch[0].replace(/\D/g, "");
      if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
        phone = phoneMatch[0].trim();
      }
    }
  }

  // 4. Classify remaining header lines into fullName, location, and explicitHeadline.
  let fullName: string | null = null;
  let location: string | null = null;
  let explicitHeadline: string | null = null;

  for (const rawLine of params.headerLines) {
    // Split pipe- or bullet-separated contact strips if present on one line.
    const parts = rawLine
      .split(/\s*[|•·]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (
        part.includes("@") ||
        lower.includes("linkedin.com") ||
        lower.includes("github.com") ||
        /^https?:\/\//i.test(part)
      ) {
        continue;
      }

      const digitsOnly = part.replace(/\D/g, "");
      if (digitsOnly.length >= 8 && /^[\d+\s().-]+$/.test(part)) {
        continue;
      }

      if (
        !fullName &&
        part.length >= 2 &&
        part.length <= 70 &&
        !/\d/.test(part) &&
        !part.includes(",") &&
        part.split(/\s+/).length <= 5
      ) {
        fullName = part;
        continue;
      }

      if (
        !location &&
        part.length <= 80 &&
        (/^remote$/i.test(part) ||
          /^[A-Za-z .'-]+,\s*[A-Za-z .'-]{2,30}(?:,\s*[A-Za-z .'-]{2,30})?$/.test(
            part,
          ))
      ) {
        location = part;
        continue;
      }

      if (!explicitHeadline && fullName && part.length <= 140) {
        explicitHeadline = part;
      }
    }
  }

  return {
    fullName,
    explicitHeadline,
    location,
    phone,
    websiteUrl,
    linkedinUrl,
    githubUrl,
  };
}

function deriveHeadlineFromSummary(
  summaryText: string | null,
  fallbackJobTitle: string | null,
): string | null {
  if (summaryText) {
    const clauseMatch =
      /^([A-Z][^.,;]{3,95}?)(?:\s+(?:holding|with|based|specializing|focused|experienced)\b|[.,;])/i.exec(
        summaryText,
      );
    if (clauseMatch?.[1]) {
      const candidate = clauseMatch[1].trim();
      if (candidate.length >= 4 && candidate.length <= 100) {
        return candidate;
      }
    }
  }

  return fallbackJobTitle;
}

function sanitizeSkillCommasInsideParens(raw: string): string {
  return raw.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    const normalizedInner = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" / ");
    return `(${normalizedInner})`;
  });
}

function splitTopLevelCommas(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of raw) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;

    if ((ch === "," || ch === ";" || ch === "|") && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseSkillsSection(lines: string[]): string | null {
  if (lines.length === 0) return null;

  const seen = new Set<string>();
  const collected: string[] = [];
  let totalLength = 0;

  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/^[-•*▪‣]\s*/, "").trim();
    if (!cleaned) continue;

    if (SKILL_CATEGORY_HEADER_PATTERNS.some((pattern) => pattern.test(cleaned))) {
      continue;
    }

    // Handle "Category: Skill 1, Skill 2" lines by stripping the category label.
    const colonMatch = /^([A-Za-z &/]{3,40}):\s*(.+)$/.exec(cleaned);
    const body = colonMatch?.[2] ? colonMatch[2].trim() : cleaned;

    for (const rawItem of splitTopLevelCommas(body)) {
      const normalizedItem = sanitizeSkillCommasInsideParens(rawItem)
        .replace(/^[-•*▪‣]\s*/, "")
        .trim();

      if (!normalizedItem || normalizedItem.length > 90) continue;
      if (
        SKILL_CATEGORY_HEADER_PATTERNS.some((pattern) =>
          pattern.test(normalizedItem),
        )
      ) {
        continue;
      }

      const key = normalizedItem.toLowerCase();
      if (seen.has(key)) continue;

      const addedLength =
        collected.length === 0 ? normalizedItem.length : normalizedItem.length + 2;
      if (totalLength + addedLength > 1950) {
        break;
      }

      seen.add(key);
      collected.push(normalizedItem);
      totalLength += addedLength;
    }
  }

  return collected.length > 0 ? collected.join(", ") : null;
}

function isBulletOrSentenceLine(line: string): boolean {
  if (/^[-•*▪‣]\s+/.test(line)) return true;
  if (/^[A-Z][^:.]{3,75}:\s+\S/.test(line)) return true;
  return line.length > 115;
}

function isJobHeaderCandidate(line: string): boolean {
  if (isBulletOrSentenceLine(line)) return false;
  if (/^[a-z]/.test(line)) return false;
  if (
    /[.!?]$/.test(line) &&
    !/\b(?:Inc|Ltd|Co|Corp|Pty|LLC|LLP|Plc|S\.A|B\.V)\.$/.test(line)
  ) {
    return false;
  }
  return line.length <= 100;
}

function formatBulletDescription(lines: string[]): string | null {
  if (lines.length === 0) return null;

  const groups: string[][] = [];
  let currentGroup: string[] = [];

  for (const rawLine of lines) {
    const hasExplicitBullet = /^[-•*▪‣]\s+/.test(rawLine);
    const cleaned = rawLine.replace(/^[-•*▪‣]\s+/, "").trim();
    if (!cleaned) continue;

    const startsNamedBullet = /^[A-Z][^:.]{3,75}:\s+\S/.test(cleaned);

    if ((hasExplicitBullet || startsNamedBullet) && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [cleaned];
    } else {
      currentGroup.push(cleaned);
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  const formatted = groups
    .map((group) => {
      const paragraph = joinWrappedLines(group);
      return groups.length > 1 ? `• ${paragraph}` : paragraph;
    })
    .filter(Boolean)
    .join("\n");

  if (!formatted) return null;
  return formatted.slice(0, 4000);
}

function splitCompanyAndLocation(raw: string): {
  company: string;
  location: string | null;
} {
  const cleaned = raw
    .replace(EMPLOYMENT_TYPE_REGEX, "")
    .replace(/\s*[|·—–]\s*$/, "")
    .trim();

  // Handle "Company | Descriptor, City, Region" or "Company | Location".
  if (cleaned.includes("|")) {
    const segments = cleaned
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length >= 2 && segments[0]) {
      const tail = segments.slice(1).join(" · ");
      const commaLocMatch = /^(.+?),\s*([^,]+,\s*[A-Z]{2,3}|Remote(?:,\s*[A-Za-z]+)?)$/.exec(
        tail,
      );
      if (commaLocMatch?.[2]) {
        return {
          company: segments[0].slice(0, 256),
          location: commaLocMatch[2].trim().slice(0, 256),
        };
      }
      return {
        company: segments[0].slice(0, 256),
        location: tail.slice(0, 256),
      };
    }
  }

  // Handle "Company Name, City, State/Country" or "Company Name, Remote, SG".
  const twoPartLocMatch =
    /^(.+?),\s*((?:Remote|[A-Z][A-Za-z .'-]+),\s*(?:[A-Z]{2,3}|[A-Z][A-Za-z .'-]{2,25}))$/.exec(
      cleaned,
    );
  if (twoPartLocMatch?.[1] && twoPartLocMatch[2]) {
    return {
      company: twoPartLocMatch[1].trim().slice(0, 256),
      location: twoPartLocMatch[2].trim().slice(0, 256),
    };
  }

  const remoteSuffixMatch = /^(.+?),\s*(Remote)$/i.exec(cleaned);
  if (remoteSuffixMatch?.[1] && remoteSuffixMatch[2]) {
    return {
      company: remoteSuffixMatch[1].trim().slice(0, 256),
      location: remoteSuffixMatch[2].trim().slice(0, 256),
    };
  }

  return {
    company: cleaned.slice(0, 256),
    location: null,
  };
}

function parseExperiencesSection(lines: string[]): ExtractedExperienceEntry[] {
  if (lines.length === 0) return [];

  const dateLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && DATE_RANGE_REGEX.test(line) && !isBulletOrSentenceLine(line)) {
      dateLineIndices.push(i);
    }
  }

  if (dateLineIndices.length === 0) {
    return [];
  }

  interface RawExperienceChunk {
    dateIndex: number;
    headerStart: number;
    headerEnd: number;
    startDate: string;
    endDate: string | null;
    isCurrent: boolean;
    headerParts: string[];
  }

  const chunks: RawExperienceChunk[] = [];

  for (let idx = 0; idx < dateLineIndices.length; idx += 1) {
    const dateIdx = dateLineIndices[idx];
    if (dateIdx === undefined) continue;

    const dateLine = lines[dateIdx] ?? "";
    const dateMatch = DATE_RANGE_REGEX.exec(dateLine);
    if (!dateMatch?.[1] || !dateMatch[2]) continue;

    const startDate = dateMatch[1].trim().slice(0, 64);
    const rawEnd = dateMatch[2].trim();
    const isCurrent = /^(?:present|current|now)$/i.test(rawEnd);
    const endDate = isCurrent ? null : rawEnd.slice(0, 64);

    const prevBoundary = idx === 0 ? 0 : (chunks[idx - 1]?.headerEnd ?? 0) + 1;
    // Look up to 2 short non-bullet header lines immediately before the date line for job title / company.
    let headerStart = dateIdx;
    for (
      let lookback = dateIdx - 1;
      lookback >= Math.max(prevBoundary, dateIdx - 2);
      lookback -= 1
    ) {
      const candidate = lines[lookback];
      if (!candidate || !isJobHeaderCandidate(candidate)) {
        break;
      }
      headerStart = lookback;
    }

    const headerParts: string[] = [];
    for (let j = headerStart; j < dateIdx; j += 1) {
      const part = lines[j];
      if (part) headerParts.push(part);
    }

    const dateLineRemainder = dateLine
      .replace(dateMatch[0], "")
      .replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "")
      .trim();
    if (dateLineRemainder) {
      headerParts.push(dateLineRemainder);
    }

    let headerEnd = dateIdx;
    const nextDateIdx = dateLineIndices[idx + 1] ?? lines.length;
    const afterDateIdx = dateIdx + 1;
    const afterDateLine = lines[afterDateIdx];

    if (
      headerParts.length <= 1 &&
      afterDateIdx < nextDateIdx &&
      afterDateLine &&
      isJobHeaderCandidate(afterDateLine) &&
      !DATE_RANGE_REGEX.test(afterDateLine)
    ) {
      headerParts.push(afterDateLine);
      headerEnd = afterDateIdx;
    }

    chunks.push({
      dateIndex: dateIdx,
      headerStart,
      headerEnd,
      startDate,
      endDate,
      isCurrent,
      headerParts,
    });
  }

  const results: ExtractedExperienceEntry[] = [];

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunk = chunks[idx];
    if (!chunk) continue;

    const nextHeaderStart = chunks[idx + 1]?.headerStart ?? lines.length;
    const descLines = lines.slice(chunk.headerEnd + 1, nextHeaderStart);

    const joinedHeader = chunk.headerParts.join(" ");
    const empMatch = EMPLOYMENT_TYPE_REGEX.exec(joinedHeader);
    const employmentType = empMatch?.[1]
      ? empMatch[1].replace(/\s+/g, "-").slice(0, 128)
      : null;

    let jobTitle = "";
    let companyRaw = "";

    if (chunk.headerParts.length >= 2) {
      jobTitle = (chunk.headerParts[0] ?? "").trim();
      companyRaw = chunk.headerParts.slice(1).join(", ").trim();
    } else if (chunk.headerParts.length === 1) {
      const single = chunk.headerParts[0] ?? "";
      const atSplit = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(single);
      const sepSplit = /^(.+?)\s*[|—–]\s*(.+)$/.exec(single);
      if (atSplit?.[1] && atSplit[2]) {
        jobTitle = atSplit[1].trim();
        companyRaw = atSplit[2].trim();
      } else if (sepSplit?.[1] && sepSplit[2]) {
        jobTitle = sepSplit[1].trim();
        companyRaw = sepSplit[2].trim();
      } else {
        jobTitle = single.trim();
        companyRaw = "Organization";
      }
    }

    if (!jobTitle) continue;

    const { company, location } = splitCompanyAndLocation(
      companyRaw || "Organization",
    );

    results.push({
      jobTitle: jobTitle.slice(0, 256),
      company: (company || "Organization").slice(0, 256),
      employmentType,
      location,
      startDate: chunk.startDate,
      endDate: chunk.endDate,
      isCurrent: chunk.isCurrent,
      description: formatBulletDescription(descLines),
    });
  }

  return results;
}

function isEducationHeaderLine(line: string): boolean {
  if (/^[-•*▪‣]\s+/.test(line)) return false;
  if (
    /^(?:relevant\s+coursework|coursework|thesis|awards?|activities|gpa|grade)\s*:/i.test(
      line,
    )
  ) {
    return false;
  }
  if (line.length > 140) return false;
  return (
    INSTITUTION_KEYWORD_REGEX.test(line) || DEGREE_KEYWORD_REGEX.test(line)
  );
}

function splitEducationSchoolAndDegree(line: string): {
  school: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
} {
  const parts = line
    .split(/\s*(?:,|—|–|\|)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  let school: string | null = null;
  let degree: string | null = null;
  let fieldOfStudy: string | null = null;

  for (const part of parts) {
    if (!school && INSTITUTION_KEYWORD_REGEX.test(part)) {
      school = part;
    } else if (!degree && DEGREE_KEYWORD_REGEX.test(part)) {
      degree = part;
    } else if (!school && !INSTITUTION_KEYWORD_REGEX.test(part) && degree) {
      school = part;
    } else if (!degree && school) {
      degree = part;
    }
  }

  if (degree) {
    const inMatch = /^(.+?)\s+in\s+(.+)$/i.exec(degree);
    if (inMatch?.[1] && inMatch[2] && !DEGREE_KEYWORD_REGEX.test(inMatch[2])) {
      degree = inMatch[1].trim();
      fieldOfStudy = inMatch[2].trim();
    }
  }

  return { school, degree, fieldOfStudy };
}

function parseEducationsSection(lines: string[]): ExtractedEducationEntry[] {
  if (lines.length === 0) return [];

  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    const isHeader = isEducationHeaderLine(line);
    const currentHasSchoolAndDegree =
      currentBlock.length > 0 &&
      splitEducationSchoolAndDegree(currentBlock[0] ?? "").school !== null &&
      splitEducationSchoolAndDegree(currentBlock[0] ?? "").degree !== null;

    if (
      isHeader &&
      currentBlock.length > 0 &&
      (currentHasSchoolAndDegree || currentBlock.length >= 2)
    ) {
      blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  const results: ExtractedEducationEntry[] = [];

  for (const block of blocks) {
    const firstLine = block[0];
    if (!firstLine) continue;

    let { school, degree, fieldOfStudy } =
      splitEducationSchoolAndDegree(firstLine);
    let startDate = "Completed";
    let endDate: string | null = null;
    let isCurrent = false;
    let grade: string | null = null;
    let location: string | null = null;

    const descLines: string[] = [];

    for (let i = 1; i < block.length; i += 1) {
      const line = block[i];
      if (!line) continue;

      const dateMatch = DATE_RANGE_REGEX.exec(line);
      if (dateMatch?.[1] && dateMatch[2] && !isBulletOrSentenceLine(line)) {
        startDate = dateMatch[1].trim().slice(0, 64);
        const rawEnd = dateMatch[2].trim();
        isCurrent = /^(?:present|current|now|expected)$/i.test(rawEnd);
        endDate = isCurrent ? null : rawEnd.slice(0, 64);
        const remainder = line.replace(dateMatch[0], "").replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "").trim();
        if (remainder && !location) {
          location = remainder.slice(0, 256);
        }
        continue;
      }

      if (
        !degree &&
        DEGREE_KEYWORD_REGEX.test(line) &&
        !isBulletOrSentenceLine(line)
      ) {
        const parsed = splitEducationSchoolAndDegree(line);
        degree = parsed.degree ?? line;
        fieldOfStudy ??= parsed.fieldOfStudy;
        continue;
      }

      if (
        !school &&
        INSTITUTION_KEYWORD_REGEX.test(line) &&
        !isBulletOrSentenceLine(line)
      ) {
        const parsed = splitEducationSchoolAndDegree(line);
        school = parsed.school ?? line;
        continue;
      }

      const gradeMatch = /(?:GPA|Grade|WAM|Result)\s*[:\-]\s*([^|•\n]+)/i.exec(
        line,
      );
      if (gradeMatch?.[1] && !grade && !isBulletOrSentenceLine(line)) {
        grade = gradeMatch[1].trim().slice(0, 128);
        continue;
      }

      descLines.push(line);
    }

    if (!school && !degree) {
      continue;
    }

    // Format coursework + bullet lines cleanly into description.
    const groupedDescLines: string[] = [];
    const courseworkGroup: string[] = [];
    const bulletGroups: string[][] = [];
    let activeBullet: string[] = [];
    let inCoursework = false;

    for (const line of descLines) {
      if (/^[-•*▪‣]\s+/.test(line)) {
        inCoursework = false;
        if (activeBullet.length > 0) {
          bulletGroups.push(activeBullet);
        }
        activeBullet = [line.replace(/^[-•*▪‣]\s+/, "").trim()];
      } else if (/^(?:relevant\s+coursework|coursework|thesis)\s*:/i.test(line)) {
        inCoursework = true;
        courseworkGroup.push(line);
      } else if (inCoursework && activeBullet.length === 0) {
        courseworkGroup.push(line);
      } else if (activeBullet.length > 0) {
        activeBullet.push(line);
      } else {
        groupedDescLines.push(line);
      }
    }

    if (activeBullet.length > 0) {
      bulletGroups.push(activeBullet);
    }

    const descriptionParts: string[] = [];
    if (courseworkGroup.length > 0) {
      descriptionParts.push(joinWrappedLines(courseworkGroup));
    }
    if (groupedDescLines.length > 0) {
      descriptionParts.push(joinWrappedLines(groupedDescLines));
    }
    for (const bullet of bulletGroups) {
      descriptionParts.push(`• ${joinWrappedLines(bullet)}`);
    }

    const description =
      descriptionParts.length > 0
        ? descriptionParts.join("\n").slice(0, 4000)
        : null;

    results.push({
      school: (school ?? firstLine).slice(0, 256),
      degree: (degree ?? "Degree / Program").slice(0, 256),
      fieldOfStudy: fieldOfStudy ? fieldOfStudy.slice(0, 256) : null,
      location,
      startDate,
      endDate,
      isCurrent,
      grade,
      description,
    });
  }

  return results;
}

export function parseResumeIntoStructuredData(params: {
  lines: string[];
  links: string[];
  pagesProcessed: number;
  modelUsed?: string;
}): ExtractedResumeData {
  const { headerLines, sections } = splitSections(params.lines);
  const identity = extractContactAndIdentity({
    headerLines,
    allLinks: params.links,
  });

  const summaryRaw =
    sections.summary.length > 0 ? joinWrappedLines(sections.summary) : null;
  const summary = summaryRaw ? summaryRaw.slice(0, 4000) : null;
  const skills = parseSkillsSection(sections.skills);
  const parsedExperiences = parseExperiencesSection(sections.experience);
  const parsedEducations = parseEducationsSection(sections.education);

  const headline =
    identity.explicitHeadline ??
    deriveHeadlineFromSummary(
      summary,
      parsedExperiences[0]?.jobTitle ?? null,
    );

  return {
    profile: {
      fullName: identity.fullName ? identity.fullName.slice(0, 256) : null,
      headline: headline ? headline.slice(0, 256) : null,
      location: identity.location ? identity.location.slice(0, 256) : null,
      phone: identity.phone ? identity.phone.slice(0, 64) : null,
      websiteUrl: identity.websiteUrl ? identity.websiteUrl.slice(0, 512) : null,
      linkedinUrl: identity.linkedinUrl
        ? identity.linkedinUrl.slice(0, 512)
        : null,
      githubUrl: identity.githubUrl ? identity.githubUrl.slice(0, 512) : null,
      summary,
      skills,
    },
    experiences: parsedExperiences,
    educations: parsedEducations,
    pagesProcessed: params.pagesProcessed,
    modelUsed: params.modelUsed ?? "deterministic-parser",
  };
}

function encodeSigV4UriPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function signAwsBedrockRequest(params: {
  url: URL;
  payload: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.payload);
  const contentType = "application/json";
  const canonicalUri = encodeSigV4UriPath(params.url.pathname);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${params.url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "POST",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/bedrock/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, "bedrock");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return {
    "content-type": contentType,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

const nullableTrimmedString = (maxLen: number) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((val) => {
      const trimmed = val?.trim();
      return trimmed && trimmed.length > 0 ? trimmed.slice(0, maxLen) : null;
    });

const bedrockResumeSchema = z.object({
  profile: z.object({
    fullName: nullableTrimmedString(256),
    headline: nullableTrimmedString(256),
    location: nullableTrimmedString(256),
    phone: nullableTrimmedString(64),
    websiteUrl: nullableTrimmedString(512),
    linkedinUrl: nullableTrimmedString(512),
    githubUrl: nullableTrimmedString(512),
    summary: nullableTrimmedString(4000),
    skills: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional()
      .transform((val) => {
        if (!val) return null;
        const list = Array.isArray(val) ? val : splitTopLevelCommas(val);
        const cleaned = list
          .map((item) => sanitizeSkillCommasInsideParens(item).trim())
          .filter(
            (item) =>
              item.length > 0 &&
              !SKILL_CATEGORY_HEADER_PATTERNS.some((p) => p.test(item)),
          );
        return cleaned.length > 0 ? cleaned.join(", ").slice(0, 1950) : null;
      }),
  }),
  experiences: z
    .array(
      z.object({
        jobTitle: z.string().trim().min(1).max(256),
        company: z.string().trim().min(1).max(256),
        employmentType: nullableTrimmedString(128),
        location: nullableTrimmedString(256),
        startDate: z.string().trim().min(1).max(64),
        endDate: nullableTrimmedString(64),
        isCurrent: z.boolean().optional().default(false),
        description: z
          .union([z.string(), z.array(z.string())])
          .nullable()
          .optional()
          .transform((val) => {
            if (!val) return null;
            if (Array.isArray(val)) {
              const lines = val
                .map((s) => s.replace(/^[-•*▪‣]\s*/, "").trim())
                .filter(Boolean)
                .map((s) => `• ${s}`);
              return lines.length > 0 ? lines.join("\n").slice(0, 4000) : null;
            }
            const trimmed = val.trim();
            return trimmed.length > 0 ? trimmed.slice(0, 4000) : null;
          }),
      }),
    )
    .optional()
    .default([]),
  educations: z
    .array(
      z.object({
        school: z.string().trim().min(1).max(256),
        degree: z.string().trim().min(1).max(256),
        fieldOfStudy: nullableTrimmedString(256),
        location: nullableTrimmedString(256),
        startDate: z
          .string()
          .nullable()
          .optional()
          .transform((val) => {
            const trimmed = val?.trim();
            return trimmed && trimmed.length > 0
              ? trimmed.slice(0, 64)
              : "Completed";
          }),
        endDate: nullableTrimmedString(64),
        isCurrent: z.boolean().optional().default(false),
        grade: nullableTrimmedString(128),
        description: z
          .union([z.string(), z.array(z.string())])
          .nullable()
          .optional()
          .transform((val) => {
            if (!val) return null;
            if (Array.isArray(val)) {
              const lines = val
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) =>
                  /^(?:relevant\s+coursework|coursework|thesis)\s*:/i.test(s) ||
                  s.startsWith("•")
                    ? s
                    : `• ${s.replace(/^[-*▪‣]\s*/, "")}`,
                );
              return lines.length > 0 ? lines.join("\n").slice(0, 4000) : null;
            }
            const trimmed = val.trim();
            return trimmed.length > 0 ? trimmed.slice(0, 4000) : null;
          }),
      }),
    )
    .optional()
    .default([]),
});

function extractJsonObjectString(rawText: string): string {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }
  return stripped;
}

function getBedrockCandidateModels(): string[] {
  const configured = env.AWS_BEDROCK_MODEL_ID?.trim();
  const models: string[] = [];
  if (configured) {
    models.push(configured);
  }
  for (const model of COST_EFFECTIVE_BEDROCK_MODELS) {
    if (!models.includes(model)) {
      models.push(model);
    }
  }
  return models;
}

async function invokeBedrockConverseModel(params: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION ?? "ap-southeast-2";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are not configured.");
  }

  const url = new URL(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(params.modelId)}/converse`,
  );

  const payload = JSON.stringify({
    system: [{ text: params.systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: params.userPrompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 3500,
      temperature: 0,
    },
  });

  const headers = signAwsBedrockRequest({
    url,
    payload,
    region,
    accessKeyId,
    secretAccessKey,
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: payload,
  });

  const rawBody = await response.text();
  let parsed: BedrockConverseResponse = {};
  try {
    parsed = JSON.parse(rawBody) as BedrockConverseResponse;
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const errMsg =
      parsed.message ??
      parsed.Message ??
      (rawBody || `Bedrock HTTP ${response.status}`);
    throw new Error(`Bedrock (${params.modelId}) failed: ${errMsg}`);
  }

  const text = parsed.output?.message?.content?.[0]?.text;
  if (!text) {
    throw new Error(`Bedrock (${params.modelId}) returned an empty response.`);
  }

  return text;
}

/**
 * Uses Amazon Bedrock (defaulting to cost-effective Amazon Nova Micro / Nova Lite)
 * to structure OCR lines and hyperlink annotations into candidate profile data.
 */
async function structureResumeWithBedrock(params: {
  lines: string[];
  links: string[];
  pagesProcessed: number;
  deterministicFallback: ExtractedResumeData;
}): Promise<ExtractedResumeData> {
  const systemPrompt = [
    "You are an expert resume data extraction engine.",
    "Given OCR lines extracted by Amazon Textract and embedded PDF/document hyperlink URLs, output ONLY a valid JSON object matching this exact structure (no markdown fences, no commentary):",
    "{",
    '  "profile": {',
    '    "fullName": string | null,',
    '    "headline": string | null,',
    '    "location": string | null,',
    '    "phone": string | null,',
    '    "websiteUrl": string | null,',
    '    "linkedinUrl": string | null,',
    '    "githubUrl": string | null,',
    '    "summary": string | null,',
    '    "skills": string | null',
    "  },",
    '  "experiences": [',
    "    {",
    '      "jobTitle": string,',
    '      "company": string,',
    '      "employmentType": string | null,',
    '      "location": string | null,',
    '      "startDate": string,',
    '      "endDate": string | null,',
    '      "isCurrent": boolean,',
    '      "description": string | null',
    "    }",
    "  ],",
    '  "educations": [',
    "    {",
    '      "school": string,',
    '      "degree": string,',
    '      "fieldOfStudy": string | null,',
    '      "location": string | null,',
    '      "startDate": string,',
    '      "endDate": string | null,',
    '      "isCurrent": boolean,',
    '      "grade": string | null,',
    '      "description": string | null',
    "    }",
    "  ]",
    "}",
    "Rules:",
    "1. Heal any word-wrap hyphenations across line breaks (e.g. 'algorith-mic' -> 'algorithmic', 'mod-els' -> 'models', 'trans-form' -> 'transform', 'REST-ful' -> 'RESTful'), while keeping genuine compound hyphens ('full-stack', 'multi-dimensional', 'well-tested').",
    "2. For 'headline', use the candidate's professional title or the opening role summary phrase (e.g. 'Analytical Software Engineer and Data Platform Engineer').",
    "3. For 'linkedinUrl' and 'githubUrl', return full https:// URLs. For 'githubUrl', use the main user profile URL (https://github.com/<username>), NOT a specific project repository URL. For 'websiteUrl', only include a personal portfolio URL from the top contact header—do NOT use project demo URLs from the Projects section.",
    "4. For 'skills', return a comma-separated string of all individual technical skills/tools from the Skills section. Omit category headings like 'Languages & Core Systems', 'Software Engineering & Testing', 'Cloud & Data Platforms', 'Scientific & Data Modelling', 'Frameworks & Web', 'Analytics & Governance'. Replace commas inside parentheses with ' / ' (e.g. 'Python (asyncio / Flask)').",
    "5. For 'experiences', extract ONLY roles from the Work Experience / Experience section (do not include Projects or Volunteer roles). Handle entries that span across page breaks so continuation lines at the top of page 2 remain attached to the role from the bottom of page 1. Format 'description' with each bullet prefixed by '• ' and separated by '\\n'. If endDate is Present/Current, set isCurrent: true and endDate: null.",
    "6. For 'educations', extract all degrees from the Education section. If a degree has no explicit start/end dates on the resume, set startDate to 'Completed' and endDate to null. If the degree name already includes the discipline (e.g. 'Master of Data Science', 'Bachelor of Computer Engineering'), set fieldOfStudy to null so it is not duplicated. Include Relevant Coursework and achievement bullets in 'description' separated by '\\n'.",
  ].join("\n");

  const userPrompt = [
    "Embedded Hyperlink Annotations:",
    params.links.length > 0 ? params.links.join("\n") : "(none)",
    "",
    "Resume OCR Lines (in reading order):",
    params.lines.join("\n"),
  ].join("\n");

  const candidateModels = getBedrockCandidateModels();
  let lastError: unknown = null;

  for (const modelId of candidateModels) {
    try {
      const rawOutput = await invokeBedrockConverseModel({
        modelId,
        systemPrompt,
        userPrompt,
      });

      const jsonString = extractJsonObjectString(rawOutput);
      const parsedJson: unknown = JSON.parse(jsonString);
      const validated = bedrockResumeSchema.parse(parsedJson);
      const fb = params.deterministicFallback;

      const linkedinUrl =
        (validated.profile.linkedinUrl
          ? ensureHttpsUrl(validated.profile.linkedinUrl)
          : null) ?? fb.profile.linkedinUrl;

      // Ensure githubUrl is the profile root rather than a sub-repo link if fallback found the profile root.
      const bedrockGithub = validated.profile.githubUrl
        ? ensureHttpsUrl(validated.profile.githubUrl)
        : null;
      const githubUrl =
        fb.profile.githubUrl ?? bedrockGithub;

      // Only trust websiteUrl if the deterministic header check also found one in the header.
      const websiteUrl =
        fb.profile.websiteUrl ??
        (validated.profile.websiteUrl &&
        params.lines
          .slice(0, 10)
          .join(" ")
          .toLowerCase()
          .includes(
            validated.profile.websiteUrl
              .replace(/^https?:\/\/(?:www\.)?/i, "")
              .toLowerCase(),
          )
          ? ensureHttpsUrl(validated.profile.websiteUrl)
          : null);

      const experiences: ExtractedExperienceEntry[] =
        validated.experiences.length > 0
          ? validated.experiences.map((exp) => ({
              jobTitle: exp.jobTitle,
              company: exp.company,
              employmentType: exp.employmentType,
              location: exp.location,
              startDate: exp.startDate,
              endDate: exp.isCurrent ? null : exp.endDate,
              isCurrent: exp.isCurrent,
              description: exp.description,
            }))
          : fb.experiences;

      const educations: ExtractedEducationEntry[] =
        validated.educations.length > 0
          ? validated.educations.map((edu) => {
              const duplicateField =
                edu.fieldOfStudy &&
                edu.degree
                  .toLowerCase()
                  .includes(edu.fieldOfStudy.toLowerCase());
              return {
                school: edu.school,
                degree: edu.degree,
                fieldOfStudy: duplicateField ? null : edu.fieldOfStudy,
                location: edu.location,
                startDate: edu.startDate,
                endDate: edu.isCurrent ? null : edu.endDate,
                isCurrent: edu.isCurrent,
                grade: edu.grade,
                description: edu.description,
              };
            })
          : fb.educations;

      return {
        profile: {
          fullName: validated.profile.fullName ?? fb.profile.fullName,
          headline: validated.profile.headline ?? fb.profile.headline,
          location: validated.profile.location ?? fb.profile.location,
          phone: validated.profile.phone ?? fb.profile.phone,
          websiteUrl,
          linkedinUrl,
          githubUrl,
          summary: validated.profile.summary ?? fb.profile.summary,
          skills: validated.profile.skills ?? fb.profile.skills,
        },
        experiences,
        educations,
        pagesProcessed: params.pagesProcessed,
        modelUsed: modelId,
      };
    } catch (err) {
      lastError = err;
      console.warn(
        `Bedrock resume structuring with model "${modelId}" failed, trying next fallback:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.warn(
    "All Bedrock candidate models failed; falling back to deterministic parser:",
    lastError,
  );
  return params.deterministicFallback;
}

/**
 * Extracts candidate profile, experience, and education data from a resume buffer
 * using AWS Textract for OCR and Amazon Bedrock (Nova Micro / Lite) for structured parsing.
 */
export async function extractResumeProfile(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<ExtractedResumeData> {
  const { lines, links, pagesProcessed } =
    await extractDocumentTextAndLinks(params);

  if (lines.length === 0) {
    throw new Error(
      "No readable text was found in the uploaded resume file.",
    );
  }

  const deterministicFallback = parseResumeIntoStructuredData({
    lines,
    links,
    pagesProcessed,
  });

  return structureResumeWithBedrock({
    lines,
    links,
    pagesProcessed,
    deterministicFallback,
  });
}
