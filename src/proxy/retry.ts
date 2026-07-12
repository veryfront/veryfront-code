/**
 * Retry utilities for the proxy server.
 */

import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_RUN_STREAM_PATH = /^\/api\/control-plane\/runs\/[^/]+\/stream$/;

type RequestBodyReplayKind = "bodyless" | "bounded" | "unsupported";

/**
 * Check if a fetch error is a transient connection error worth retrying.
 * These occur when renderer pods are being recycled or temporarily unavailable.
 */
export function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("connection reset") ||
    msg.includes("connection closed") ||
    msg.includes("connection refused") ||
    msg.includes("os error 104") || // ECONNRESET
    msg.includes("os error 111") // ECONNREFUSED
  );
}

function isConnectionRefusedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("connection refused") || message.includes("os error 111");
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
  if (length === 0) return "bodyless";
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
  const retryCount = Math.max(0, configuredRetryCount);
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
  const attemptCount = Math.max(0, retryCount) + 1;
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
