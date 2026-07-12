/**
 * Retry utilities for the proxy server.
 */

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

/**
 * Decide how many times the proxy can safely retry an upstream request.
 *
 * Ordinary non-idempotent requests are not replayed. The control-plane run
 * stream attach endpoint is a bodyless POST, so it can safely retry once to
 * fall back from an unavailable dedicated runtime to the shared runtime during
 * operator reconciliation.
 */
export function getUpstreamRetryCount(
  method: string,
  pathname: string,
  headers: Headers,
  configuredRetryCount: number,
): number {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return configuredRetryCount;

  const isBodylessControlPlaneRunStreamPost = method === "POST" &&
    requestHeadersDeclareBody(headers) === false &&
    /^\/api\/control-plane\/runs\/[^/]+\/stream$/.test(pathname);

  return isBodylessControlPlaneRunStreamPost ? configuredRetryCount : 0;
}

export function getFramedRequestBody(
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> | null {
  return requestHeadersDeclareBody(headers) ? body : null;
}

function requestHeadersDeclareBody(headers: Headers): boolean {
  const contentLength = headers.get("content-length");
  if (contentLength !== null && contentLength.trim() !== "" && contentLength !== "0") {
    return true;
  }

  const transferEncoding = headers.get("transfer-encoding");
  return transferEncoding !== null && transferEncoding.trim() !== "";
}
