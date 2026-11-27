/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

class BoundedMap<K, V> extends Map<K, V> {
  maxEntries: number;
  constructor(maxEntries: number) {
    super();
    this.maxEntries = maxEntries;
  }
  set(key: K, value: V): this {
    if (this.has(key)) {
      this.delete(key);
    } else if (this.size >= this.maxEntries) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.set(key, value);
  }
}

class ClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientInputError";
  }
}

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32);

function stripHttpOptions(val: any): any {
  if (!val || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(stripHttpOptions);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    if (
      k === "httpOptions" ||
      k === "http_options" ||
      k === "abortSignal" ||
      k === "abort_signal" ||
      k === "__proto__" ||
      k === "constructor" ||
      k === "prototype" ||
      k === "cachedContent" ||
      k === "cached_content" ||
      k === "fileSearch" ||
      k === "file_search" ||
      k === "fileSearchStoreNames" ||
      k === "file_search_store_names" ||
      k === "corpora" ||
      k === "semanticRetriever" ||
      k === "semantic_retriever" ||
      k === "previous_interaction_id" ||
      k === "previousInteractionId" ||
      k === "environment" ||
      k === "environment_id" ||
      k === "environmentId" ||
      k === "safetySettings" ||
      k === "safety_settings" ||
      k === "fileData" ||
      k === "file_data"
    ) {
      continue;
    }
    out[k] = stripHttpOptions(v);
  }
  return out;
}

const MODEL_UPGRADES: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3-flash-preview",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "gemini-2.0-flash": "gemini-3-flash-preview",
  "gemini-2.0-flash-exp": "gemini-3-flash-preview",
  "gemini-flash-latest": "gemini-3-flash-preview",
};

const EXACT_SHOWCASE_HOST_RE =
  /^(?:[a-z0-9-]+-853813963450|ais-(?:dev|pre)-[a-z0-9-]+-\d+)\.[a-z0-9-]+\.run\.app$/;

function isCloudRunRuntime(): boolean {
  return typeof process.env.K_SERVICE === "string" && process.env.K_SERVICE.trim().length > 0;
}

function getConfiguredAppHostname(): string {
  const raw = (process.env.APP_URL || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedOriginUrl(rawUrl: string, inCloudRun: boolean, requestHost?: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (inCloudRun && parsed.protocol !== "https:") return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (requestHost && hostname === requestHost) {
      return true;
    }
    const configuredHost = getConfiguredAppHostname();
    if (configuredHost && hostname === configuredHost) {
      return true;
    }
    if (
      !inCloudRun &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".usercontent.goog"))
    ) {
      return true;
    }
    return (
      hostname === "aistudio.google.com" ||
      hostname === "ai.studio" ||
      hostname.endsWith(".ai.studio") ||
      EXACT_SHOWCASE_HOST_RE.test(hostname)
    );
  } catch {
    return false;
  }
}

function isAllowedRequestOrigin(req: express.Request): boolean {
  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (secFetchSite === "cross-site") {
    return false;
  }
  const rawHost = typeof req.headers.host === "string" ? req.headers.host.trim().toLowerCase() : "";
  const requestHost = rawHost ? rawHost.split(":")[0] : "";
  const rawOrigin = req.headers.origin;
  const origin = typeof rawOrigin === "string" ? rawOrigin.trim() : "";
  const inCloudRun = isCloudRunRuntime();

  if (!origin) {
    if (secFetchSite === "same-origin") {
      return true;
    }
    if (req.method === "GET") {
      const referer = typeof req.headers.referer === "string" ? req.headers.referer.trim() : "";
      if (referer) {
        return isAllowedOriginUrl(referer, inCloudRun, requestHost);
      }
    }
    return false;
  }
  if (origin === "null") return false;
  return isAllowedOriginUrl(origin, inCloudRun, requestHost);
}

function isInternalOrLoopbackIp(ip: string): boolean {
  const clean = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip.toLowerCase();
  if (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.startsWith("127.") ||
    clean.startsWith("10.") ||
    clean.startsWith("169.254.") ||
    clean.startsWith("192.168.") ||
    clean.startsWith("fe80:") ||
    clean.startsWith("fc") ||
    clean.startsWith("fd")
  ) {
    return true;
  }
  const m172 = /^172\.(\d{1,3})\./.exec(clean);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function getClientIpKey(req: express.Request): string {
  const rawXff = req.headers["x-forwarded-for"];
  const xffStr = Array.isArray(rawXff)
    ? rawXff.join(",")
    : typeof rawXff === "string"
      ? rawXff
      : "";
  if (xffStr) {
    const hops = xffStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    while (hops.length > 1 && isInternalOrLoopbackIp(hops[hops.length - 1])) {
      hops.pop();
    }
    if (hops.length > 0 && isCloudRunRuntime()) {
      return `ip:${hops[hops.length - 1].toLowerCase()}`;
    }
  }
  return `ip:${(req.ip || req.socket?.remoteAddress || "unknown").toLowerCase()}`;
}

function requireClientKey(req: express.Request): string | null {
  const raw = req?.headers?.["x-client-id"];
  if (typeof raw === "string" && /^[a-zA-Z0-9._-]{8,128}$/.test(raw.trim())) {
    return `cid:${raw.trim()}`;
  }
  return null;
}

interface RateBucket {
  timestamps: number[];
  active: number;
}

interface MultiRateLimits {
  ipMaxConcurrent: number;
  ipMaxPerMinute: number;
  clientMaxConcurrent: number;
  clientMaxPerMinute: number;
  globalMaxConcurrent: number;
  globalMaxPerMinute: number;
}

const MAX_RATE_BUCKETS = 4096;
const rateBuckets = new Map<string, RateBucket>();

function pruneIdleRateBuckets(cutoff: number): void {
  for (const [k, b] of rateBuckets.entries()) {
    while (b.timestamps.length > 0 && b.timestamps[0] <= cutoff) {
      b.timestamps.shift();
    }
    if (b.active === 0 && b.timestamps.length === 0) {
      rateBuckets.delete(k);
    }
  }
}

function tryAcquireSingleBucket(
  key: string,
  now: number,
  cutoff: number,
  maxConcurrent: number,
  maxPerMinute: number
): (() => void) | null {
  let bucket = rateBuckets.get(key);
  if (bucket) {
    rateBuckets.delete(key);
    rateBuckets.set(key, bucket);
  } else {
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      pruneIdleRateBuckets(cutoff);
    }
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest !== undefined) rateBuckets.delete(oldest);
    }
    bucket = { timestamps: [], active: 0 };
    rateBuckets.set(key, bucket);
  }
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) {
    bucket.timestamps.shift();
  }
  if (bucket.active >= maxConcurrent || bucket.timestamps.length >= maxPerMinute) {
    return null;
  }
  bucket.timestamps.push(now);
  bucket.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bucket!.active = Math.max(0, bucket!.active - 1);
  };
}

function acquireMultiRateSlot(
  scope: string,
  ipKey: string,
  clientKey: string | null,
  limits: MultiRateLimits
): (() => void) | null {
  const now = Date.now();
  const cutoff = now - 60_000;
  const releasers: Array<() => void> = [];

  const globalRelease = tryAcquireSingleBucket(
    `${scope}:global`,
    now,
    cutoff,
    limits.globalMaxConcurrent,
    limits.globalMaxPerMinute
  );
  if (!globalRelease) return null;
  releasers.push(globalRelease);

  const ipRelease = tryAcquireSingleBucket(
    `${scope}:${ipKey}`,
    now,
    cutoff,
    limits.ipMaxConcurrent,
    limits.ipMaxPerMinute
  );
  if (!ipRelease) {
    globalRelease();
    const gBucket = rateBuckets.get(`${scope}:global`);
    if (gBucket && gBucket.timestamps.length > 0) gBucket.timestamps.pop();
    return null;
  }
  releasers.push(ipRelease);

  if (clientKey) {
    const clientRelease = tryAcquireSingleBucket(
      `${scope}:${clientKey}`,
      now,
      cutoff,
      limits.clientMaxConcurrent,
      limits.clientMaxPerMinute
    );
    if (!clientRelease) {
      ipRelease();
      globalRelease();
      const ipBucket = rateBuckets.get(`${scope}:${ipKey}`);
      if (ipBucket && ipBucket.timestamps.length > 0) ipBucket.timestamps.pop();
      const gBucket = rateBuckets.get(`${scope}:global`);
      if (gBucket && gBucket.timestamps.length > 0) gBucket.timestamps.pop();
      return null;
    }
    releasers.push(clientRelease);
  }

  let allReleased = false;
  return () => {
    if (allReleased) return;
    allReleased = true;
    for (const fn of releasers) fn();
  };
}

function mapSafeErrorStatus(error: any): number {
  const code = Number(error?.status ?? error?.code);
  if (code === 429) return 429;
  if (code === 400) return 400;
  if (code === 404) return 404;
  return 500;
}

const MAX_VIDEO_BUFFERS = 8;
const MAX_VIDEO_CACHE_BYTES = 120 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_IMAGE_BASE64_CHARS = Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 64;
const BASE64_DATA_RE = /^[A-Za-z0-9+/=\s]+$/;

const completedVideoOps = new BoundedMap<string, { response?: any; error?: any }>(100);
const downloadedVideoCache = new Map<string, { buffer: Buffer; mimeType: string }>();

function safeVideoMimeType(mime?: unknown): string {
  if (typeof mime === "string") {
    const normalized = mime.split(";")[0].trim().toLowerCase();
    if (/^video\/(mp4|webm)$/i.test(normalized)) return normalized;
  }
  return "video/mp4";
}

function detectImageMimeFromBuffer(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function parseValidatedBase64Image(
  rawBytes: unknown,
  rawMime: unknown
): { data: string; mimeType: string } | null {
  if (
    typeof rawBytes !== "string" ||
    !rawBytes.trim() ||
    rawBytes.length > MAX_INLINE_IMAGE_BASE64_CHARS ||
    !BASE64_DATA_RE.test(rawBytes)
  ) {
    return null;
  }
  const cleaned = rawBytes.replace(/\s+/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length <= 0 || buf.length > MAX_INLINE_IMAGE_BYTES) {
    return null;
  }
  const detectedMime = detectImageMimeFromBuffer(buf);
  if (!detectedMime) {
    return null;
  }
  const normalizedMime =
    typeof rawMime === "string" ? rawMime.trim().toLowerCase() : detectedMime;
  if (
    normalizedMime !== "image/jpeg" &&
    normalizedMime !== "image/jpg" &&
    normalizedMime !== "image/png" &&
    normalizedMime !== "image/webp"
  ) {
    return null;
  }
  return { data: cleaned, mimeType: detectedMime };
}

const ALLOWED_CONTENT_MODELS = new Set<string>(["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview", "gemini-flash-latest", "gemini-2.5-flash-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"]);

function resolveContentModel(rawModel?: unknown): string {
  const input = typeof rawModel === "string" && rawModel.trim() ? rawModel.trim() : "gemini-3-flash-preview";
  const candidate = MODEL_UPGRADES[input] || input;
  if (!ALLOWED_CONTENT_MODELS.has(candidate)) {
    throw new ClientInputError("Disallowed model requested.");
  }
  return candidate;
}

function sanitizePartList(rawParts: unknown): any[] {
  if (!Array.isArray(rawParts)) return [];
  const safeParts: any[] = [];
  for (const part of rawParts.slice(0, 12)) {
    if (!part || typeof part !== "object") continue;
    const rawSig = (part as any).thoughtSignature;
    const safeSig =
      typeof rawSig === "string" && /^[A-Za-z0-9+/=_-]{1,16384}$/.test(rawSig)
        ? rawSig
        : undefined;
    const isThought = (part as any).thought === true ? true : undefined;
    if (typeof (part as any).text === "string") {
      const outPart: Record<string, any> = { text: (part as any).text.slice(0, 24000) };
      if (safeSig) outPart.thoughtSignature = safeSig;
      if (isThought) outPart.thought = true;
      safeParts.push(outPart);
      continue;
    }
    const inline = (part as any).inlineData;
    if (inline && typeof inline === "object") {
      const validated = parseValidatedBase64Image(inline.data, inline.mimeType);
      if (!validated) {
        throw new ClientInputError("Invalid inline image payload.");
      }
      const outPart: Record<string, any> = {
        inlineData: { data: validated.data, mimeType: validated.mimeType },
      };
      if (safeSig) outPart.thoughtSignature = safeSig;
      if (isThought) outPart.thought = true;
      safeParts.push(outPart);
    }
  }
  return safeParts;
}

function sanitizeContentsPayload(rawContents: unknown): any {
  if (typeof rawContents === "string") {
    const trimmed = rawContents.trim().slice(0, 24000);
    if (!trimmed) throw new ClientInputError("Prompt text is required.");
    return trimmed;
  }
  if (Array.isArray(rawContents)) {
    if (
      rawContents.length > 0 &&
      rawContents.every(
        (item) =>
          item &&
          typeof item === "object" &&
          ("role" in item || Array.isArray((item as any).parts))
      )
    ) {
      const turns: any[] = [];
      for (const turn of rawContents.slice(0, 24)) {
        const role = (turn as any).role === "model" ? "model" : "user";
        const parts = sanitizePartList((turn as any).parts);
        if (parts.length > 0) {
          turns.push({ role, parts });
        }
      }
      if (turns.length === 0) throw new ClientInputError("Valid content turns are required.");
      return turns;
    }
    const parts = sanitizePartList(rawContents);
    if (parts.length === 0) throw new ClientInputError("Valid content parts are required.");
    return parts;
  }
  if (rawContents && typeof rawContents === "object" && Array.isArray((rawContents as any).parts)) {
    const parts = sanitizePartList((rawContents as any).parts);
    if (parts.length === 0) throw new ClientInputError("Valid content parts are required.");
    return { parts };
  }
  throw new ClientInputError("Invalid contents payload.");
}

function sanitizeGenerateContentConfig(rawCfg: any): Record<string, any> | undefined {
  if (!rawCfg || typeof rawCfg !== "object") return undefined;
  const safeCfg: Record<string, any> = {};
  if (typeof rawCfg.systemInstruction === "string" && rawCfg.systemInstruction.trim()) {
    safeCfg.systemInstruction = rawCfg.systemInstruction.slice(0, 20000);
  }
  if (typeof rawCfg.temperature === "number" && Number.isFinite(rawCfg.temperature)) {
    safeCfg.temperature = Math.min(Math.max(rawCfg.temperature, 0), 2);
  }
  if (Array.isArray(rawCfg.responseModalities)) {
    const mods = rawCfg.responseModalities.filter(
      (m: unknown) => m === "IMAGE" || m === "TEXT"
    );
    if (mods.length > 0) safeCfg.responseModalities = mods;
  }
  if (rawCfg.imageConfig && typeof rawCfg.imageConfig === "object") {
    const ic: Record<string, string> = {};
    const ar = rawCfg.imageConfig.aspectRatio;
    if (
      typeof ar === "string" &&
      /^(?:1:1|16:9|9:16|4:3|3:4|1:4|1:8|4:1|8:1)$/.test(ar)
    ) {
      ic.aspectRatio = ar;
    }
    const sz = rawCfg.imageConfig.imageSize;
    if (typeof sz === "string" && /^(?:512px|1K|2K|4K)$/.test(sz)) {
      ic.imageSize = sz;
    }
    if (Object.keys(ic).length > 0) safeCfg.imageConfig = ic;
  }
  if (rawCfg.thinkingConfig && typeof rawCfg.thinkingConfig === "object") {
    const tl = rawCfg.thinkingConfig.thinkingLevel;
    if (
      tl === "MINIMAL" ||
      tl === "LOW" ||
      tl === "MEDIUM" ||
      tl === "HIGH" ||
      tl === "THINKING_LEVEL_UNSPECIFIED"
    ) {
      safeCfg.thinkingConfig = { thinkingLevel: tl };
    }
  }
  if (rawCfg.responseMimeType === "application/json" || rawCfg.responseMimeType === "text/plain") {
    safeCfg.responseMimeType = rawCfg.responseMimeType;
  }
  if (rawCfg.responseSchema && typeof rawCfg.responseSchema === "object") {
    safeCfg.responseSchema = stripHttpOptions(rawCfg.responseSchema);
  }
  if (typeof rawCfg.maxOutputTokens === "number" && Number.isFinite(rawCfg.maxOutputTokens)) {
    safeCfg.maxOutputTokens = Math.min(Math.max(Math.trunc(rawCfg.maxOutputTokens), 64), 16384);
  }
  return Object.keys(safeCfg).length > 0 ? safeCfg : undefined;
}

function serializeGenerateContentResponse(r: any) {
  return {
    candidates: r?.candidates,
    promptFeedback: r?.promptFeedback,
    usageMetadata: r?.usageMetadata,
    modelVersion: r?.modelVersion,
    responseId: r?.responseId,
    text: r?.text,
    functionCalls: r?.functionCalls,
    data: r?.data,
  };
}

const ALLOWED_IMAGE_MODELS = new Set<string>(["imagen-4.0-generate-001", "imagen-3.0-generate-002"]);

function resolveImageModel(rawModel?: unknown): string {
  const input = typeof rawModel === "string" && rawModel.trim() ? rawModel.trim() : "imagen-4.0-generate-001";
  if (!ALLOWED_IMAGE_MODELS.has(input)) {
    throw new ClientInputError("Disallowed image model requested.");
  }
  return input;
}

function getVideoHmacKey(): Buffer {
  const configuredSecret = (
    process.env.FILE_TOKEN_SECRET ||
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    ""
  ).trim();
  if (!configuredSecret) {
    return EPHEMERAL_FALLBACK_SECRET;
  }
  return crypto
    .createHmac("sha256", "proactive-co-creator-video-hmac:v1")
    .update(`${process.env.APPLET_ID || ""}:${configuredSecret}`)
    .digest();
}

function signVideoOp(interactionId: string, ownerKey: string): string {
  const sig = crypto
    .createHmac("sha256", getVideoHmacKey())
    .update(`op:${interactionId}:${ownerKey}`)
    .digest("hex")
    .slice(0, 32);
  return `operations/omni-${interactionId}.${sig}`;
}

function verifyVideoOp(opName: string, ownerKey: string): string | null {
  const match = /^operations\/omni-([a-zA-Z0-9_-]{1,128})\.([0-9a-f]{32})$/.exec(opName);
  if (!match) return null;
  const rawInteractionId = match[1];
  const sig = match[2];
  const expectedSig = crypto
    .createHmac("sha256", getVideoHmacKey())
    .update(`op:${rawInteractionId}:${ownerKey}`)
    .digest("hex")
    .slice(0, 32);
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  return rawInteractionId;
}

function signVideoFile(rawFileId: string, ownerKey: string): string {
  const sig = crypto
    .createHmac("sha256", getVideoHmacKey())
    .update(`file:${ownerKey}:${rawFileId}`)
    .digest("hex")
    .slice(0, 32);
  return `${rawFileId}.${sig}`;
}

function verifyVideoFile(rawToken: unknown, ownerKey: string): string | null {
  if (typeof rawToken !== "string" || !rawToken) return null;
  const cleaned = rawToken.split("&")[0].split("?")[0].trim();
  const match = /^([a-zA-Z0-9_-]{1,128})\.([0-9a-f]{32})$/.exec(cleaned);
  if (!match) return null;
  const rawFileId = match[1];
  const sig = match[2];
  if (rawFileId.startsWith("environment-")) return null;
  const expectedSig = crypto
    .createHmac("sha256", getVideoHmacKey())
    .update(`file:${ownerKey}:${rawFileId}`)
    .digest("hex")
    .slice(0, 32);
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  return rawFileId;
}

function cacheVideoBufferBounded(fileId: string, buffer: Buffer, mimeType: string) {
  if (buffer.length > MAX_VIDEO_CACHE_BYTES) return;
  let totalBytes = 0;
  for (const [k, entry] of downloadedVideoCache.entries()) {
    if (k !== fileId) totalBytes += entry.buffer.length;
  }
  for (const [k, entry] of downloadedVideoCache.entries()) {
    if (k === fileId) continue;
    if (
      downloadedVideoCache.size < MAX_VIDEO_BUFFERS &&
      totalBytes + buffer.length <= MAX_VIDEO_CACHE_BYTES
    ) {
      break;
    }
    totalBytes -= entry.buffer.length;
    downloadedVideoCache.delete(k);
  }
  downloadedVideoCache.delete(fileId);
  downloadedVideoCache.set(fileId, { buffer, mimeType });
}

function extractInteractionVideo(
  interaction: any
): { uri?: string; data?: string; mimeType?: string } | null {
  const direct = interaction?.output_video;
  if (direct && (direct.uri || direct.data)) {
    return { uri: direct.uri, data: direct.data, mimeType: direct.mime_type };
  }
  if (Array.isArray(interaction?.outputs)) {
    const outVid = interaction.outputs.find((o: any) => o?.type === "video" && (o.uri || o.data));
    if (outVid) {
      return { uri: outVid.uri, data: outVid.data, mimeType: outVid.mime_type };
    }
  }
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type === "user_input") break;
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      for (let j = step.content.length - 1; j >= 0; j--) {
        const item = step.content[j];
        if (item?.type === "video" && (item.uri || item.data)) {
          return { uri: item.uri, data: item.data, mimeType: item.mime_type };
        }
      }
    }
  }
  return null;
}

function extractInteractionTextOrError(interaction: any): string {
  const firstErr = interaction?.errors?.[0]?.message;
  if (typeof firstErr === "string" && firstErr.trim()) return firstErr.trim().slice(0, 240);
  if (typeof interaction?.output_text === "string" && interaction.output_text.trim()) {
    return interaction.output_text.trim().slice(0, 240);
  }
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type === "user_input") break;
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      const txt = step.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text.trim())
        .filter(Boolean)
        .join(" ");
      if (txt) return txt.slice(0, 240);
    }
  }
  return "";
}

function sendVideoBufferWithRange(
  buffer: Buffer,
  mimeType: string,
  req: express.Request,
  res: express.Response
) {
  const total = buffer.length;
  res.setHeader("Content-Type", safeVideoMimeType(mimeType));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    res.end(buffer.subarray(start, end + 1));
    return;
  }
  res.setHeader("Content-Length", total);
  res.end(buffer);
}

async function startServer() {
  const app = express();
  app.set("trust proxy", 2);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.urlencoded({ limit: "64kb", extended: false }));
  app.use(express.json({ limit: "15mb" }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = stripHttpOptions(req.body);
    }
    next();
  });

  for (const dir of ["examples", "assets", "public"]) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      app.use(`/${dir}`, express.static(dirPath));
    }
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", (req, res, next) => {
    if (!isAllowedRequestOrigin(req)) {
      res.status(401).json({ error: "Untrusted request origin." });
      return;
    }
    next();
  });

  app.post("/api/generate-content", async (req, res): Promise<any> => {
    const ownerKey = requireClientKey(req);
    if (!ownerKey) {
      return res.status(400).json({ error: "Missing or invalid x-client-id header." });
    }
    const release = acquireMultiRateSlot("gen", getClientIpKey(req), ownerKey, {
      ipMaxConcurrent: 4,
      ipMaxPerMinute: 36,
      clientMaxConcurrent: 4,
      clientMaxPerMinute: 30,
      globalMaxConcurrent: 24,
      globalMaxPerMinute: 240,
    });
    if (!release) {
      res.setHeader("Retry-After", "4");
      return res.status(429).json({ error: "Rate limit reached. Please wait a moment and retry." });
    }
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(500).json({ error: "Service is not configured." });
      }
      const model = resolveContentModel(req.body?.model);
      const contents = sanitizeContentsPayload(req.body?.contents);
      const config = sanitizeGenerateContentConfig(req.body?.config);
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents,
        ...(config ? { config } : {}),
      });
      return res.json(serializeGenerateContentResponse(response));
    } catch (error: any) {
      console.error("[Backend] /api/generate-content error:", error);
      if (error instanceof ClientInputError) {
        return res.status(400).json({ error: error.message });
      }
      const status = mapSafeErrorStatus(error);
      if (status === 429) res.setHeader("Retry-After", "5");
      return res.status(status).json({
        error: status === 429 ? "Rate limit exceeded. Please try again shortly." : "Failed to generate content.",
      });
    } finally {
      release();
    }
  });

  app.post("/api/generate-images", async (req, res): Promise<any> => {
    const ownerKey = requireClientKey(req);
    if (!ownerKey) {
      return res.status(400).json({ error: "Missing or invalid x-client-id header." });
    }
    const release = acquireMultiRateSlot("img", getClientIpKey(req), ownerKey, {
      ipMaxConcurrent: 3,
      ipMaxPerMinute: 18,
      clientMaxConcurrent: 2,
      clientMaxPerMinute: 14,
      globalMaxConcurrent: 16,
      globalMaxPerMinute: 120,
    });
    if (!release) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "Rate limit reached. Please wait a moment and retry." });
    }
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(500).json({ error: "Service is not configured." });
      }
      const resolvedImgModel = resolveImageModel(req.body?.model);
      const safePrompt =
        typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
      if (!safePrompt) {
        return res.status(400).json({ error: "Prompt is required." });
      }
      const count = Math.min(Math.max(Math.trunc(Number(req.body?.config?.numberOfImages) || 1), 1), 4);
      const rawAspect = req.body?.config?.aspectRatio;
      const aspectRatio =
        typeof rawAspect === "string" && /^(?:1:1|16:9|9:16|4:3|3:4)$/.test(rawAspect)
          ? rawAspect
          : "16:9";
      const outputMimeType =
        req.body?.config?.outputMimeType === "image/png" ? "image/png" : "image/jpeg";

      const ai = new GoogleGenAI({ apiKey });
      try {
        const response = await ai.models.generateImages({
          model: resolvedImgModel,
          prompt: safePrompt,
          config: {
            numberOfImages: count,
            aspectRatio,
            outputMimeType,
          },
        });
        return res.json(response);
      } catch (imgErr: any) {
        console.warn("[Backend] generateImages failed, falling back to gemini-2.5-flash-image:", imgErr);
        const results = await Promise.all(
          Array.from({ length: count }, () =>
            ai.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: safePrompt,
              config: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio },
              },
            })
          )
        );
        const generatedImages: any[] = [];
        for (const r of results) {
          const imgPart = r?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
          if (imgPart?.inlineData?.data) {
            generatedImages.push({
              image: {
                imageBytes: imgPart.inlineData.data,
                mimeType: imgPart.inlineData.mimeType || "image/png",
              },
            });
          }
        }
        if (generatedImages.length > 0) {
          return res.json({ generatedImages });
        }
        throw imgErr;
      }
    } catch (error: any) {
      console.error("[Backend] /api/generate-images error:", error);
      if (error instanceof ClientInputError) {
        return res.status(400).json({ error: error.message });
      }
      const status = mapSafeErrorStatus(error);
      if (status === 429) res.setHeader("Retry-After", "5");
      return res.status(status).json({
        error: status === 429 ? "Rate limit exceeded. Please try again shortly." : "Failed to generate images.",
      });
    } finally {
      release();
    }
  });

  app.post("/api/generate-videos", async (req, res): Promise<any> => {
    const ownerKey = requireClientKey(req);
    if (!ownerKey) {
      return res.status(400).json({ error: "Missing or invalid x-client-id header." });
    }
    const release = acquireMultiRateSlot("vid", getClientIpKey(req), ownerKey, {
      ipMaxConcurrent: 2,
      ipMaxPerMinute: 6,
      clientMaxConcurrent: 2,
      clientMaxPerMinute: 4,
      globalMaxConcurrent: 12,
      globalMaxPerMinute: 36,
    });
    if (!release) {
      res.setHeader("Retry-After", "10");
      return res.status(429).json({
        error: "Too many video generation requests. Please wait a moment and try again.",
      });
    }
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(500).json({ error: "Service is not configured." });
      }
      const reqModel =
        typeof req.body?.model === "string" && req.body.model.trim()
          ? req.body.model.trim()
          : "gemini-omni-1.2-flash";
      if (reqModel !== "gemini-omni-1.2-flash") {
        return res.status(400).json({ error: "Unsupported video model." });
      }

      const inputParts: any[] = [];
      const rawStart = req.body?.image;
      if (rawStart && typeof rawStart === "object" && rawStart.imageBytes) {
        const startImg = parseValidatedBase64Image(rawStart.imageBytes, rawStart.mimeType);
        if (!startImg) {
          return res.status(400).json({ error: "Invalid start frame image." });
        }
        const rawLast = req.body?.config?.lastFrame;
        if (rawLast && typeof rawLast === "object" && rawLast.imageBytes) {
          const lastImg = parseValidatedBase64Image(rawLast.imageBytes, rawLast.mimeType);
          if (!lastImg) {
            return res.status(400).json({ error: "Invalid end frame image." });
          }
          inputParts.push({ type: "text", text: "First frame:" });
          inputParts.push({
            type: "image",
            data: startImg.data,
            mime_type: startImg.mimeType,
          });
          inputParts.push({ type: "text", text: "Last frame:" });
          inputParts.push({
            type: "image",
            data: lastImg.data,
            mime_type: lastImg.mimeType,
          });
        } else {
          inputParts.push({
            type: "image",
            data: startImg.data,
            mime_type: startImg.mimeType,
          });
        }
      }

      const refImgs = req.body?.config?.referenceImages;
      if (Array.isArray(refImgs)) {
        for (const ref of refImgs.slice(0, 3)) {
          const rawRefBytes = ref?.image?.imageBytes ?? ref?.imageBytes;
          const rawRefMime = ref?.image?.mimeType ?? ref?.mimeType;
          if (!rawRefBytes) continue;
          const parsedRef = parseValidatedBase64Image(rawRefBytes, rawRefMime);
          if (!parsedRef) {
            return res.status(400).json({ error: "Invalid reference image." });
          }
          inputParts.push({
            type: "image",
            data: parsedRef.data,
            mime_type: parsedRef.mimeType,
          });
        }
      }

      const rawPrompt =
        typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
      const safePrompt = rawPrompt
        ? `Generate a cohesive cinematic video clip matching <video_prompt>\n${rawPrompt}\n</video_prompt>`
        : "Animate this scene smoothly and cinematically.";
      inputParts.push({ type: "text", text: safePrompt });

      const rawAspect = req.body?.config?.aspectRatio;
      const aspectRatio =
        rawAspect === "9:16" || rawAspect === "16:9" ? rawAspect : "16:9";

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });

      const interaction: any = await (ai as any).interactions.create(
        {
          model: "gemini-omni-1.2-flash",
          input: [{ type: "user_input", content: inputParts }],
          background: true,
          store: true,
          stream: false,
          response_format: {
            type: "video",
            delivery: "uri",
            aspect_ratio: aspectRatio,
          },
        },
        { timeout: 60000 }
      );

      const rawInteractionId =
        typeof interaction?.id === "string" ? interaction.id.trim() : "";
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(rawInteractionId)) {
        throw new Error("Upstream video service returned an invalid interaction ID.");
      }

      const opName = signVideoOp(rawInteractionId, ownerKey);
      return res.json({
        name: opName,
        done: false,
      });
    } catch (error: any) {
      console.error("[Backend] /api/generate-videos error:", error);
      const status = mapSafeErrorStatus(error);
      if (status === 429) res.setHeader("Retry-After", "10");
      return res.status(status).json({
        error:
          status === 429
            ? "Video generation quota reached. Please try again shortly."
            : "Failed to start video generation.",
      });
    } finally {
      release();
    }
  });

  app.post("/api/videos-operation", async (req, res): Promise<any> => {
    const ownerKey = requireClientKey(req);
    if (!ownerKey) {
      return res.status(400).json({ error: "Missing or invalid x-client-id header." });
    }
    const release = acquireMultiRateSlot("vidpoll", getClientIpKey(req), ownerKey, {
      ipMaxConcurrent: 6,
      ipMaxPerMinute: 90,
      clientMaxConcurrent: 4,
      clientMaxPerMinute: 60,
      globalMaxConcurrent: 40,
      globalMaxPerMinute: 600,
    });
    if (!release) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "Polling too quickly. Please wait a moment." });
    }
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(500).json({ error: "Service is not configured." });
      }
      const opName =
        typeof req.body?.operation?.name === "string" ? req.body.operation.name.trim() : "";
      const rawInteractionId = verifyVideoOp(opName, ownerKey);
      if (!rawInteractionId) {
        return res.status(404).json({ error: "Video operation not found on server." });
      }

      const cachedResult = completedVideoOps.get(opName);
      if (cachedResult) {
        return res.json({
          name: opName,
          done: true,
          error: cachedResult.error,
          response: cachedResult.response,
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const interaction: any = await (ai as any).interactions.get(rawInteractionId);
      const status = String(interaction?.status || "");

      if (
        status === "in_progress" ||
        status === "queued" ||
        status === "requires_continuation"
      ) {
        return res.json({ name: opName, done: false });
      }

      if (
        status === "failed" ||
        status === "cancelled" ||
        status === "incomplete" ||
        status === "budget_exceeded"
      ) {
        const errPayload = {
          message: `Video generation ${status.replace(/_/g, " ")}.`,
        };
        completedVideoOps.set(opName, { error: errPayload });
        return res.json({ name: opName, done: true, error: errPayload });
      }

      if (status !== "completed") {
        return res.json({ name: opName, done: false });
      }

      const videoOut = extractInteractionVideo(interaction);
      if (videoOut?.uri) {
        const fileIdMatch = /\/files\/([a-zA-Z0-9_-]{1,128})(?::|$)/.exec(videoOut.uri);
        const rawFileId =
          fileIdMatch && !fileIdMatch[1].startsWith("environment-") ? fileIdMatch[1] : null;
        if (!rawFileId) {
          const errPayload = { message: "Generated video reference was invalid." };
          completedVideoOps.set(opName, { error: errPayload });
          return res.json({ name: opName, done: true, error: errPayload });
        }

        const canonicalFileName = `files/${rawFileId}`;
        if (!/^files\/[a-zA-Z0-9_-]{1,128}$/.test(canonicalFileName)) {
          return res.status(400).json({ error: "Invalid video file identifier." });
        }
        const fileInfo = await ai.files.get({ name: canonicalFileName });
        const fileState = String((fileInfo?.state as any)?.name || fileInfo?.state || "");
        if (fileState === "PROCESSING" || fileState === "STATE_UNSPECIFIED") {
          return res.json({ name: opName, done: false });
        }
        if (fileState === "FAILED") {
          const errPayload = { message: "Generated video failed during file processing." };
          completedVideoOps.set(opName, { error: errPayload });
          return res.json({ name: opName, done: true, error: errPayload });
        }

        const signedFile = signVideoFile(rawFileId, ownerKey);
        const responsePayload = {
          generatedVideos: [
            {
              video: {
                uri: `/api/video-download?file=${encodeURIComponent(signedFile)}`,
              },
            },
          ],
        };
        completedVideoOps.set(opName, { response: responsePayload });
        return res.json({ name: opName, done: true, response: responsePayload });
      }

      if (videoOut?.data) {
        const inlineId = `inline_${rawInteractionId.slice(0, 48)}`;
        const videoBuffer = Buffer.from(videoOut.data, "base64");
        cacheVideoBufferBounded(inlineId, videoBuffer, safeVideoMimeType(videoOut.mimeType));
        const signedInline = signVideoFile(inlineId, ownerKey);
        const responsePayload = {
          generatedVideos: [
            {
              video: {
                uri: `/api/video-download?file=${encodeURIComponent(signedInline)}`,
              },
            },
          ],
        };
        completedVideoOps.set(opName, { response: responsePayload });
        return res.json({ name: opName, done: true, response: responsePayload });
      }

      const refusalMsg =
        extractInteractionTextOrError(interaction) ||
        "No videos were generated. The prompt may have been blocked.";
      const errPayload = { message: refusalMsg };
      completedVideoOps.set(opName, { error: errPayload });
      return res.json({ name: opName, done: true, error: errPayload });
    } catch (error: any) {
      console.error("[Backend] /api/videos-operation error:", error);
      const status = mapSafeErrorStatus(error);
      if (status === 429) res.setHeader("Retry-After", "5");
      return res.status(status).json({ error: "Failed to poll video operation." });
    } finally {
      release();
    }
  });

  app.get("/api/video-download", async (req, res): Promise<any> => {
    const ownerKey = requireClientKey(req);
    if (!ownerKey) {
      return res.status(400).json({ error: "Missing or invalid x-client-id header." });
    }
    const release = acquireMultiRateSlot("viddl", getClientIpKey(req), ownerKey, {
      ipMaxConcurrent: 4,
      ipMaxPerMinute: 40,
      clientMaxConcurrent: 4,
      clientMaxPerMinute: 30,
      globalMaxConcurrent: 24,
      globalMaxPerMinute: 240,
    });
    if (!release) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: "Too many video download requests." });
    }
    try {
      const rawFileId = verifyVideoFile(req.query.file, ownerKey);
      if (
        !rawFileId ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(rawFileId) ||
        rawFileId.startsWith("environment-")
      ) {
        return res.status(404).json({ error: "Video not found." });
      }

      const cached = downloadedVideoCache.get(rawFileId);
      if (cached) {
        return sendVideoBufferWithRange(cached.buffer, cached.mimeType, req, res);
      }
      if (rawFileId.startsWith("inline_")) {
        return res.status(404).json({ error: "Video not found." });
      }

      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(500).json({ error: "Service is not configured." });
      }

      const canonicalUrl = `https://generativelanguage.googleapis.com/v1beta/files/${encodeURIComponent(rawFileId)}:download?alt=media`;
      const upstream = await fetch(canonicalUrl, {
        headers: { "x-goog-api-key": apiKey },
        redirect: "error",
      });
      if (!upstream.ok) {
        const errStatus =
          upstream.status === 404 ? 404 : upstream.status === 429 ? 429 : 500;
        return res.status(errStatus).json({
          error: "Failed to fetch generated video.",
        });
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const mimeType = safeVideoMimeType(upstream.headers.get("content-type"));
      cacheVideoBufferBounded(rawFileId, buffer, mimeType);
      return sendVideoBufferWithRange(buffer, mimeType, req, res);
    } catch (error: any) {
      console.error("[Backend] /api/video-download error:", error);
      return res.status(500).json({ error: "Failed to download video." });
    } finally {
      release();
    }
  });

  const distIndexPath = path.join(process.cwd(), "dist", "index.html");
  const isProductionRuntime = (): boolean =>
    fs.existsSync(distIndexPath) &&
    (process.env.NODE_ENV === "production" ||
      (Boolean((process.env.K_SERVICE || "").trim()) && process.env.npm_lifecycle_event !== "dev"));

  app.use("/api", (_req: any, res: any) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  if (!isProductionRuntime()) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { dotfiles: "ignore" }));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Server running on http://localhost:${PORT}`);
  });
}

startServer();
