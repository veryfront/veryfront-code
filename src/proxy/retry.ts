/**
 * Retry utilities for the proxy server.
 */

import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_RUN_STREAM_PATH = /^\/api\/control-plane\/runs\/[^/]+\/stream$/;
const MAX_ERROR_CAUSE_DEPTH = 8;
const MAX_UPSTREAM_RETRY_COUNT = 10;
const RETRYABLE_CONNECTION_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
const CONNECTION_REFUSED_CODES = new Set(["ECONNREFUSED"]);

type RequestBodyReplayKind = "bodyless" | "bounded" | "unsupported";

interface ErrorDetails {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
}

function normalizeRetryCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, MAX_UPSTREAM_RETRY_COUNT);
}

function errorChainMatches(
  error: unknown,
  predicate: (message: string, code: string) => boolean,
): boolean {
  if (!(error instanceof Error)) return false;

  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null || seen.has(current)) return false;
    seen.add(current);

    const details = current as ErrorDetails;
    let rawMessage: unknown;
    let rawCode: unknown;
    let cause: unknown;
    try {
      rawMessage = details.message;
      rawCode = details.code;
      cause = details.cause;
    } catch {
      return false;
    }
    const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";
    const code = typeof rawCode === "string" ? rawCode.toUpperCase() : "";
    if (predicate(message, code)) return true;

    current = cause;
  }

  return false;
}

/**
 * Check if a fetch error is a transient connection error worth retrying.
 * These occur when renderer pods are being recycled or temporarily unavailable.
 */
export function isRetryableConnectionError(error: unknown): boolean {
  return errorChainMatches(
    error,
    (message, code) =>
      RETRYABLE_CONNECTION_CODES.has(code) ||
      message.includes("connection reset") ||
      message.includes("connection closed") ||
      message.includes("connection refused") ||
      message.includes("os error 104") || // ECONNRESET
      message.includes("os error 111"), // ECONNREFUSED
  );
}

/** Checks whether an error chain reports a refused upstream connection. */
export function isConnectionRefusedError(error: unknown): boolean {
  return errorChainMatches(
    error,
    (message, code) =>
      CONNECTION_REFUSED_CODES.has(code) ||
      message.includes("connection refused") ||
      message.includes("os error 111"),
  );
}

function isIdempotentMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isControlPlaneRunStreamPost(request: Request, pathname: string): boolean {
  return request.method === "POST" && CONTROL_PLANE_RUN_STREAM_PATH.test(pathname);
}

function getRequestBodyReplayKind(request: Request): RequestBodyReplayKind {
  const transferEncoding = request.headers.get("transfer-encoding");
  if (transferEncoding !== null && transferEncoding.trim() !== "") {
    return "unsupported";
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return request.body === null ? "bodyless" : "unsupported";

  const normalizedLength = contentLength.trim();
  if (!/^\d+$/.test(normalizedLength)) return "unsupported";

  const length = Number(normalizedLength);
  if (length === 0) return request.body === null ? "bodyless" : "unsupported";
  if (
    request.body === null ||
    !Number.isSafeInteger(length) ||
    length > DEFAULT_MAX_BODY_SIZE_BYTES
  ) {
    return "unsupported";
  }
  return "bounded";
}

/**
 * Decide how many times the proxy can safely retry an upstream request.
 *
 * Ordinary non-idempotent requests are not replayed. A bounded control-plane
 * run stream invocation may retry to the shared runtime when the dedicated
 * runtime refuses the connection. Missing, chunked, invalid, and oversized
 * bodies remain single-shot so cloning cannot buffer unbounded input.
 */
export function getUpstreamRetryCount(
  request: Request,
  pathname: string,
  configuredRetryCount: number,
): number {
  const bodyKind = getRequestBodyReplayKind(request);
  if (bodyKind === "unsupported") return 0;
  const retryCount = normalizeRetryCount(configuredRetryCount);
  if (isIdempotentMethod(request.method)) return retryCount;
  if (isControlPlaneRunStreamPost(request, pathname)) {
    return Math.min(retryCount, 1);
  }

  return 0;
}

/** Decide whether this failure mode is safe to replay for the request. */
export function shouldRetryUpstreamRequest(
  request: Request,
  pathname: string,
  error: unknown,
): boolean {
  if (!isRetryableConnectionError(error)) return false;
  if (isIdempotentMethod(request.method)) return true;
  if (!isControlPlaneRunStreamPost(request, pathname)) return false;

  const bodyKind = getRequestBodyReplayKind(request);
  if (bodyKind === "bodyless") return true;
  return bodyKind === "bounded" && isConnectionRefusedError(error);
}

/**
 * Build one independently consumable body stream for every upstream attempt.
 * Request bodies are one-shot streams, so reusing the first stream would make
 * a retry fail before it reaches the fallback runtime. Cloning before the
 * first fetch preserves the exact signed bytes for each attempt.
 */
export function getReplayableRequestBodies(
  request: Request,
  retryCount: number,
): Array<ReadableStream<Uint8Array> | null> {
  const attemptCount = normalizeRetryCount(retryCount) + 1;
  const bodyKind = getRequestBodyReplayKind(request);
  if (bodyKind === "bodyless") {
    return Array.from({ length: attemptCount }, () => null);
  }
  if (bodyKind === "unsupported" || attemptCount === 1) return [request.body];

  const bodies: Array<ReadableStream<Uint8Array> | null> = [];
  for (let attempt = 1; attempt < attemptCount; attempt++) {
    bodies.push(request.clone().body);
  }
  bodies.push(request.body);
  return bodies;
}
