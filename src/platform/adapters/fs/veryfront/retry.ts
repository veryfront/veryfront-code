/**
 * Simple retry helper for transient API failures in the FS adapter.
 *
 * Retries once after a short delay for network errors and 5xx responses.
 * Does NOT retry 4xx errors (client errors like 404 are not transient).
 *
 * @module platform/adapters/fs/veryfront/retry
 */

import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("fs-retry");

/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 500;

/** Check if an error is likely transient (network issue or server error) */
function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) return true;

  const status = (error as { status?: number })?.status;
  if (typeof status === "number" && status >= 500) return true;

  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("socket hang up") ||
    message.includes("network")
  ) {
    return true;
  }

  return false;
}

/**
 * Execute an async function with a single retry for transient errors.
 * Non-transient errors (4xx, validation) are thrown immediately.
 */
export async function withRetryOnTransient<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientError(error)) throw error;

    logger.warn(`${context} — transient error, retrying once`, {
      error: error instanceof Error ? error.message : String(error),
    });

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    return fn();
  }
}
