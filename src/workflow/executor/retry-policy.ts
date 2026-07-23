import { isVeryfrontError } from "#veryfront/errors/http-error.ts";
import type { RetryConfig } from "../types.ts";

/** Default initial delay before first retry attempt */
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 1_000;

/** Default maximum delay between retry attempts */
export const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Node/Deno transient network error codes. Matched as whole tokens against
 * error.code (or, when a plain Error carries no code, its message). Unlike
 * "429"/"503"/"timeout", these tokens are specific enough not to appear
 * incidentally in unrelated error text.
 */
const RETRYABLE_CODE_RE = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND)\b/;

/**
 * Shared transient-error classification for workflow retries. Callers are
 * responsible for non-cooperative-error bookkeeping before consulting this.
 */
export function isRetryableWorkflowError(error: Error, config: RetryConfig | undefined): boolean {
  if (config?.retryIf) return config.retryIf(error);

  // Prefer structured signals over substring-matching the message: an error
  // whose text merely contains "429" or "timeout" (e.g. "Found 429 items")
  // must NOT be retried. VeryfrontError carries an HTTP-style status, so HTTP
  // conditions (429/503/timeout) are classified by status, not text.
  if (isVeryfrontError(error)) return RETRYABLE_STATUSES.has(error.status);

  // System/network errors: use the stable `code` when present, else fall back
  // to the message but only for the specific code tokens above.
  const code = (error as { code?: unknown }).code;
  const subject = typeof code === "string" ? code : error.message;
  return RETRYABLE_CODE_RE.test(subject);
}

/** Backoff delay (fixed/linear/exponential per config) with ±10% jitter. */
export function calculateRetryDelay(attempt: number, config: RetryConfig | undefined): number {
  const initialDelay = config?.initialDelay ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
  const maxDelay = config?.maxDelay ?? DEFAULT_RETRY_MAX_DELAY_MS;

  let baseDelay = initialDelay;
  if (config?.backoff === "exponential") baseDelay = initialDelay * Math.pow(2, attempt - 1);
  else if (config?.backoff === "linear") baseDelay = initialDelay * attempt;

  const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
  return Math.floor(Math.min(baseDelay + jitter, maxDelay));
}
