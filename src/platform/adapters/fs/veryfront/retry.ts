/**
 * Simple retry helper for transient API failures in the FS adapter.
 *
 * Retries once after a short delay for network errors and 5xx responses.
 * Does NOT retry 4xx errors (client errors like 404 are not transient).
 *
 * @module platform/adapters/fs/veryfront/retry
 */

import { logger as baseLogger } from "#veryfront/utils";
import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";

const logger = baseLogger.component("fs-retry");

/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 500;

/** Check if an error is likely transient (network issue or server error) */
function isTransientError(error: unknown): boolean {
  // Narrow TypeError to known fetch/network failure messages only.
  // Bare `error.message.includes("fetch")` is too broad and can match
  // non-network TypeErrors (e.g., type validation mentioning "fetch").
  if (error instanceof TypeError) {
    const msg = error.message;
    if (
      msg.includes("fetch failed") || // Deno runtime fetch failure
      msg.includes("Failed to fetch") || // browser/undici fetch failure
      msg.includes("error sending request") ||
      msg.includes("NetworkError when attempting to fetch") ||
      msg.includes("network error") // documented Fetch API network error string
    ) {
      return true;
    }
  }

  const status = (error as { status?: number })?.status;
  if (typeof status === "number" && status >= 500) return true;

  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENETUNREACH") ||
    message.includes("socket hang up") ||
    message.includes("network error") // specific phrase; see note below
    // Note: bare "network" intentionally omitted — too broad, matches unrelated
    // validation errors that mention "network settings" etc. The two-word
    // "network error" phrase is specific enough to avoid those false positives.
  ) {
    return true;
  }

  return false;
}

/**
 * Execute an async function with a single retry for transient errors.
 * Non-transient errors (4xx, validation) are thrown immediately.
 */
export function withRetryOnTransient<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T> {
  return retryWithBackoff(() => fn(), {
    maxAttempts: 2,
    computeDelay: () => RETRY_DELAY_MS,
    shouldRetry: (error) => isTransientError(error),
    onRetry: ({ error }) => {
      logger.warn(`${context} — transient error, retrying once`, {
        error: error.message,
      });
    },
  });
}
