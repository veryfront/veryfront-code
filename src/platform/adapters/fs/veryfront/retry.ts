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
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const logger = baseLogger.component("fs-retry");

/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 500;

function getOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (isNativeErrorWithoutHooks(error)) {
    const message = getOwnDataProperty(error, "message");
    return typeof message === "string" ? message : "";
  }

  switch (typeof error) {
    case "string":
      return error;
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return String(error);
    default:
      return "";
  }
}

function isNativeTypeError(error: unknown): boolean {
  if (!isNativeErrorWithoutHooks(error)) return false;

  try {
    let prototype = Object.getPrototypeOf(error);
    while (prototype !== null) {
      if (prototype === TypeError.prototype) return true;
      if (isProxyWithoutHooks(prototype)) return false;
      prototype = Object.getPrototypeOf(prototype);
    }
  } catch {
    return false;
  }

  return false;
}

/** Check if an error is likely transient (network issue or server error) */
function isTransientError(error: unknown): boolean {
  // Narrow TypeError to known fetch/network failure messages only.
  // Bare `error.message.includes("fetch")` is too broad and can match
  // non-network TypeErrors (e.g., type validation mentioning "fetch").
  const message = getSafeErrorMessage(error);
  if (isNativeTypeError(error)) {
    if (
      message.includes("fetch failed") || // Deno runtime fetch failure
      message.includes("Failed to fetch") || // browser/undici fetch failure
      message.includes("error sending request") ||
      message.includes("NetworkError when attempting to fetch") ||
      message.includes("network error") // documented Fetch API network error string
    ) {
      return true;
    }
  }

  const status = getOwnDataProperty(error, "status");
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 500 &&
    status <= 599
  ) {
    return true;
  }

  if (
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENETUNREACH") ||
    message.includes("socket hang up") ||
    message.includes("network error") // specific phrase; see note below
    // Note: bare "network" intentionally omitted because it matches unrelated
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
      logger.warn(`${context}: transient error, retrying once`, {
        error: getSafeErrorMessage(error),
      });
    },
  });
}
