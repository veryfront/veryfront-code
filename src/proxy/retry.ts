/**
 * Retry utilities for the proxy server.
 */

import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_RUN_STREAM_PATH = /^\/api\/control-plane\/runs\/[^/]+\/stream$/;
const MAX_ERROR_CAUSE_DEPTH = 8;
const MAX_UPSTREAM_RETRY_COUNT = 5;
const RETRYABLE_CONNECTION_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
const CONNECTION_REFUSED_CODES = new Set(["ECONNREFUSED"]);

type RequestBodyReplayKind = "bodyless" | "bounded" | "unsupported";

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function readOwnErrorDetails(value: object):
  | Readonly<{
    message: unknown;
    code: unknown;
    cause: unknown;
  }>
  | null {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const readDataValue = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  return Object.freeze({
    message: readDataValue("message"),
    code: readDataValue("code"),
    cause: readDataValue("cause"),
  });
}

function errorChainMatches(
  error: unknown,
  predicate: (message: string, code: string) => boolean,
): boolean {
  if (!isError(error)) return false;

  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null || seen.has(current)) return false;
    seen.add(current);

    const details = readOwnErrorDetails(current);
    if (!details) return false;
    const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
    const code = typeof details.code === "string" ? details.code.toUpperCase() : "";
    if (predicate(message, code)) return true;

    current = details.cause;
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
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

function isControlPlaneRunStreamPost(request: Request, pathname: string): boolean {
  return request.method.toUpperCase() === "POST" &&
    CONTROL_PLANE_RUN_STREAM_PATH.test(pathname);
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

function requireRetryCount(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_UPSTREAM_RETRY_COUNT
  ) {
    throw new RangeError(
      `Upstream retry count must be an integer between 0 and ${MAX_UPSTREAM_RETRY_COUNT}`,
    );
  }
  return value;
}

/**
 * Decide how many times the proxy can safely retry an upstream request.
 *
 * Ordinary non-idempotent requests are not replayed. A bounded control-plane
 * run stream invocation may retry to the shared runtime when the dedicated
 * runtime refuses the connection. Missing, chunked, invalid, and oversized
 * bodies remain single-shot so teeing cannot buffer unbounded input.
 */
export function getUpstreamRetryCount(
  request: Request,
  pathname: string,
  configuredRetryCount: number,
): number {
  const retryCount = requireRetryCount(configuredRetryCount);
  const bodyKind = getRequestBodyReplayKind(request);
  if (bodyKind === "unsupported") return 0;
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
 * a retry fail before it reaches the fallback runtime. Tee branches created
 * before the first fetch preserve the exact signed bytes for each attempt.
 */
export function getReplayableRequestBodies(
  request: Request,
  retryCount: number,
): Array<ReadableStream<Uint8Array> | null> {
  const attemptCount = requireRetryCount(retryCount) + 1;
  const bodyKind = getRequestBodyReplayKind(request);
  if (bodyKind === "bodyless") {
    return Array.from({ length: attemptCount }, () => null);
  }
  if (bodyKind === "unsupported" || attemptCount === 1) return [request.body];

  const bodies: Array<ReadableStream<Uint8Array> | null> = [];
  let remainingBody = request.body!;
  for (let attempt = 1; attempt < attemptCount; attempt++) {
    const [attemptBody, nextRemainingBody] = remainingBody.tee();
    bodies.push(attemptBody);
    remainingBody = nextRemainingBody;
  }
  bodies.push(remainingBody);
  return bodies;
}
