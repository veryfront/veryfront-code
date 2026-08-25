import { isVeryfrontErrorInstance } from "#veryfront/errors/types.ts";
import {
  hasTransientErrorCode,
  telemetryErrorType,
} from "#veryfront/observability/telemetry-error.ts";
import type { RetryConfig } from "../types.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const mathFloor = Math.floor;
const mathMin = Math.min;
const mathPow = Math.pow;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const setHas = Set.prototype.has;

function hasOwn(descriptor: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, descriptor, [key]) as boolean;
}

function readOwnDataField(value: unknown, key: PropertyKey): unknown {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) return undefined;
  try {
    const descriptor = getOwnPropertyDescriptor(value, key);
    return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Default initial delay before first retry attempt */
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 1_000;

/** Default maximum delay between retry attempts */
export const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Shared transient-error classification for workflow retries. Callers are
 * responsible for non-cooperative-error bookkeeping before consulting this.
 */
export function isRetryableWorkflowError(error: Error, config: RetryConfig | undefined): boolean {
  const retryIf = readOwnDataField(config, "retryIf");
  if (typeof retryIf === "function") {
    try {
      return apply(retryIf, config, [error]) === true;
    } catch {
      return false;
    }
  }

  // Prefer structured signals over substring-matching the message: an error
  // whose text merely contains "429" or "timeout" (e.g. "Found 429 items")
  // must NOT be retried. VeryfrontError carries an HTTP-style status, so HTTP
  // conditions (429/503/timeout) are classified by status, not text.
  if (isVeryfrontErrorInstance(error)) {
    const status = readOwnDataField(error, "status");
    return typeof status === "number" &&
      apply(setHas, RETRYABLE_STATUSES, [status]) === true;
  }

  // System/network errors: use the stable `code` when present, else fall back
  // to the message but only for the specific code tokens above.
  const code = readOwnDataField(error, "code");
  const message = readOwnDataField(error, "message");
  const subject = typeof code === "string" ? code : (typeof message === "string" ? message : "");
  return hasTransientErrorCode(subject);
}

/**
 * Public-safe retry telemetry classification. Never include the error message here.
 *
 * Delegates to the shared telemetry classifier so retry events and span statuses
 * cannot drift apart.
 */
export function retryTelemetryErrorType(error: Error): string {
  return telemetryErrorType(error);
}

/** Backoff delay (fixed/linear/exponential per config) with ±10% jitter. */
export function calculateRetryDelay(attempt: number, config: RetryConfig | undefined): number {
  const initialDelay = config?.initialDelay ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
  const maxDelay = config?.maxDelay ?? DEFAULT_RETRY_MAX_DELAY_MS;

  let baseDelay = initialDelay;
  if (config?.backoff === "exponential") baseDelay = initialDelay * mathPow(2, attempt - 1);
  else if (config?.backoff === "linear") baseDelay = initialDelay * attempt;

  // Keep randomness injectable through Math.random. Tracing tests and hosts use
  // this seam to make the one jitter draw deterministic; the arithmetic around
  // that draw is captured so project code cannot replace the delay calculation.
  const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
  return mathFloor(mathMin(baseDelay + jitter, maxDelay));
}
