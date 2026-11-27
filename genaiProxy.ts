/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const Type = {
  TYPE_UNSPECIFIED: "TYPE_UNSPECIFIED",
  STRING: "STRING",
  NUMBER: "NUMBER",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
  ARRAY: "ARRAY",
  OBJECT: "OBJECT",
  NULL: "NULL",
} as const;
export type Type = (typeof Type)[keyof typeof Type];

export const Modality = {
  MODALITY_UNSPECIFIED: "MODALITY_UNSPECIFIED",
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
  DOCUMENT: "DOCUMENT",
} as const;
export type Modality = (typeof Modality)[keyof typeof Modality];

export const ThinkingLevel = {
  THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
  MINIMAL: "MINIMAL",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

export const HarmCategory = {
  HARM_CATEGORY_UNSPECIFIED: "HARM_CATEGORY_UNSPECIFIED",
  HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
  HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT",
  HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
  HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  HARM_CATEGORY_CIVIC_INTEGRITY: "HARM_CATEGORY_CIVIC_INTEGRITY",
} as const;
export type HarmCategory = (typeof HarmCategory)[keyof typeof HarmCategory];

export const HarmBlockThreshold = {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
  BLOCK_LOW_AND_ABOVE: "BLOCK_LOW_AND_ABOVE",
  BLOCK_MEDIUM_AND_ABOVE: "BLOCK_MEDIUM_AND_ABOVE",
  BLOCK_ONLY_HIGH: "BLOCK_ONLY_HIGH",
  BLOCK_NONE: "BLOCK_NONE",
  OFF: "OFF",
} as const;
export type HarmBlockThreshold = (typeof HarmBlockThreshold)[keyof typeof HarmBlockThreshold];

export const VideoGenerationReferenceType = {
  ASSET: "ASSET",
  STYLE: "STYLE",
} as const;
export type VideoGenerationReferenceType =
  (typeof VideoGenerationReferenceType)[keyof typeof VideoGenerationReferenceType];

export type Part = any;
export type Content = any;
export type Tool = any;
export type FunctionDeclaration = any;
export type Schema = any;
export type GenerateContentResponse = any;
export type GenerateImagesResponse = any;
export type GeneratedImage = any;
export type GeneratedVideo = any;

/** Error enriched with HTTP status and optional Retry-After delay in ms. */
export interface ProxyHttpError extends Error {
  status?: number;
  retryAfterMs?: number;
}

let fallbackClientId = "";

/**
 * Returns a stable per-tab client identifier, falling back to an in-memory UUID
 * when cross-site iframe storage policies block `window.sessionStorage`.
 */
export function getClientId(): string {
  try {
    const storage = window.sessionStorage;
    const existing = storage.getItem("__aistudio_client_id");
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    storage.setItem("__aistudio_client_id", created);
    return created;
  } catch {
    if (!fallbackClientId) {
      fallbackClientId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    }
    return fallbackClientId;
  }
}

/**
 * Parses numeric delta-seconds or HTTP-date `Retry-After` header values into a
 * bounded millisecond backoff delay without producing `NaN`.
 */
export function parseRetryAfterMs(rawHeader: string | null): number | undefined {
  if (!rawHeader) return undefined;
  const trimmed = rawHeader.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(Math.max(Math.ceil(secs * 1000), 500), 60_000);
    }
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    return Math.min(Math.max(deltaMs, 500), 60_000);
  }
  return undefined;
}

/**
 * Strips non-serializable `abortSignal` fields from request bodies while
 * returning any active `AbortSignal` to pass directly to `fetch()`.
 */
function extractSignalAndSanitizeBody(body: any): {
  cleanBody: any;
  signal?: AbortSignal;
} {
  if (!body || typeof body !== "object") {
    return { cleanBody: body };
  }
  let signal: AbortSignal | undefined;
  const cleanBody = { ...body };
  if (cleanBody.config && typeof cleanBody.config === "object") {
    const { abortSignal, abort_signal, ...restConfig } = cleanBody.config;
    if (abortSignal && typeof abortSignal === "object" && "aborted" in abortSignal) {
      signal = abortSignal as AbortSignal;
    } else if (abort_signal && typeof abort_signal === "object" && "aborted" in abort_signal) {
      signal = abort_signal as AbortSignal;
    }
    cleanBody.config = restConfig;
  }
  if (cleanBody.msgConfig && typeof cleanBody.msgConfig === "object") {
    const { abortSignal, abort_signal, ...restMsgConfig } = cleanBody.msgConfig;
    if (!signal && abortSignal && typeof abortSignal === "object" && "aborted" in abortSignal) {
      signal = abortSignal as AbortSignal;
    }
    cleanBody.msgConfig = restMsgConfig;
  }
  return { cleanBody, signal };
}

async function readJsonSafely(response: Response): Promise<{ isJson: boolean; data: any }> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return { isJson: false, data: { error: text ? text.slice(0, 300) : "" } };
  }
  try {
    const data = await response.json();
    return { isJson: true, data };
  } catch {
    return { isJson: false, data: {} };
  }
}

function buildHttpError(response: Response, data: any): ProxyHttpError {
  const rawErr =
    typeof data?.error === "string"
      ? data.error.trim()
      : typeof data?.error?.message === "string"
        ? data.error.message.trim()
        : "";
  const message =
    rawErr && !rawErr.startsWith("<!DOCTYPE") && !rawErr.startsWith("<html")
      ? rawErr
      : `Request failed with status ${response.status}`;
  const err: ProxyHttpError = new Error(message);
  err.status = response.status;
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  if (retryAfterMs !== undefined) {
    err.retryAfterMs = retryAfterMs;
  }
  return err;
}

async function postJson(url: string, body: any) {
  const { cleanBody, signal } = extractSignalAndSanitizeBody(body);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": getClientId() },
    body: JSON.stringify(cleanBody),
    ...(signal ? { signal } : {}),
  });
  const { isJson, data } = await readJsonSafely(response);
  if (!response.ok) {
    throw buildHttpError(response, data);
  }
  if (!isJson) {
    const err: ProxyHttpError = new Error("Unexpected non-JSON response from server.");
    err.status = 502;
    throw err;
  }
  return data;
}


export class GoogleGenAI {
  constructor(_options?: any) {}

  models = {
    generateContent: async (params: any): Promise<any> => {
      return await postJson("/api/generate-content", params);
    },
    generateImages: async (params: any): Promise<any> => {
      return await postJson("/api/generate-images", params);
    },
    generateVideos: async (params: any): Promise<any> => {
      return await postJson("/api/generate-videos", params);
    },
  };

  operations = {
    getVideosOperation: async (params: any): Promise<any> => {
      return await postJson("/api/videos-operation", params);
    },
  };
}
