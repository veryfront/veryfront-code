import { INVALID_ARGUMENT } from "#veryfront/errors";

const MAX_API_PATH_SEGMENT_LENGTH = 4_096;
const MAX_REQUEST_TIMEOUT_MS = 60 * 60 * 1_000;
const MAX_API_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_API_JSON_REQUEST_BYTES = 4 * 1024 * 1024;

function containsAsciiControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function encodeApiPathSegment(value: string, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_API_PATH_SEGMENT_LENGTH || containsAsciiControl(value)
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} must be a non-empty string of at most ${MAX_API_PATH_SEGMENT_LENGTH} characters`,
    });
  }
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

export function assertRequestTimeoutMs(requestTimeoutMs: number): void {
  if (
    !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `requestTimeoutMs must be an integer between 1 and ${MAX_REQUEST_TIMEOUT_MS}`,
    });
  }
}

export function createRequestTimeoutSignal(requestTimeoutMs: number): AbortSignal {
  assertRequestTimeoutMs(requestTimeoutMs);
  return AbortSignal.timeout(requestTimeoutMs);
}

export function formatUrlForPublicMessage(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, value.endsWith("/") ? "/" : "");
  } catch {
    return "<invalid-url>";
  }
}

export async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_API_JSON_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw INVALID_ARGUMENT.create({
        detail: `API JSON response exceeds the ${MAX_API_JSON_RESPONSE_BYTES}-byte limit`,
      });
    }
  }
  if (!response.body) {
    throw INVALID_ARGUMENT.create({ detail: "API response did not include a JSON body" });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_API_JSON_RESPONSE_BYTES) {
        await reader.cancel();
        throw INVALID_ARGUMENT.create({
          detail: `API JSON response exceeds the ${MAX_API_JSON_RESPONSE_BYTES}-byte limit`,
        });
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch (error) {
    throw INVALID_ARGUMENT.create({
      detail: `API response must contain valid JSON (${
        error instanceof Error ? error.message : String(error)
      })`,
    });
  }
}

export function stringifyBoundedJsonRequest(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "API request body must be JSON-serializable" });
  }
  if (json === undefined) {
    throw INVALID_ARGUMENT.create({ detail: "API request body must be JSON-serializable" });
  }
  if (new TextEncoder().encode(json).byteLength > MAX_API_JSON_REQUEST_BYTES) {
    throw INVALID_ARGUMENT.create({
      detail: `API request body exceeds the ${MAX_API_JSON_REQUEST_BYTES}-byte limit`,
    });
  }
  return json;
}

export async function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_REQUEST_TIMEOUT_MS) {
    throw INVALID_ARGUMENT.create({
      detail: `Delay must be an integer between 0 and ${MAX_REQUEST_TIMEOUT_MS}`,
    });
  }
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
