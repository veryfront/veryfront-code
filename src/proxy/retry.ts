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
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
