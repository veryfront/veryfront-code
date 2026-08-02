import {
  API_RETRY_INITIAL_DELAY_MS,
  API_RETRY_MAX_DELAY_MS,
  FS_RETRY_MAX_TOTAL_ATTEMPTS,
  VERYFRONT_API_DEFAULT_MAX_RETRIES,
  VERYFRONT_API_MAX_TOTAL_ATTEMPTS,
} from "./constants/retry.ts";
import { MAX_TIMER_DELAY_MS } from "./timer.ts";

export { FS_RETRY_MAX_TOTAL_ATTEMPTS as MAX_FILESYSTEM_TOTAL_ATTEMPTS };

/** Maximum Veryfront API retries after the initial request. */
export const MAX_VERYFRONT_API_RETRIES = VERYFRONT_API_MAX_TOTAL_ATTEMPTS - 1;

/** Maximum Veryfront filesystem retries after the initial request. */
export const MAX_VERYFRONT_FILESYSTEM_RETRIES = MAX_VERYFRONT_API_RETRIES;

/** Maximum GitHub total attempts under its legacy `maxRetries` contract. */
export const MAX_GITHUB_FILESYSTEM_ATTEMPTS = FS_RETRY_MAX_TOTAL_ATTEMPTS;

/**
 * A rotation renames at most `maxFiles - 1` files sequentially. This limit
 * keeps one log entry below 100 rename operations while allowing 20 times the
 * default five-file retention.
 */
export const MAX_FILE_LOG_FILES = 100;

export type FilesystemRetryCountSemantics =
  | "retries-after-initial"
  | "legacy-total-attempts";

export interface BoundedRetryConfig {
  readonly maxRetries: number;
  readonly initialDelay: number;
  readonly maxDelay: number;
}

export interface BoundedRetryConfigInput {
  readonly maxRetries?: number;
  readonly initialDelay?: number;
  readonly maxDelay?: number;
}

export type FilesystemRetryConfig = BoundedRetryConfig;
export type FilesystemRetryConfigInput = BoundedRetryConfigInput;

/** Defaults shared by public Veryfront API clients and transports. */
export const DEFAULT_VERYFRONT_API_RETRY_CONFIG: Readonly<BoundedRetryConfig> = Object.freeze({
  maxRetries: VERYFRONT_API_DEFAULT_MAX_RETRIES,
  initialDelay: API_RETRY_INITIAL_DELAY_MS,
  maxDelay: API_RETRY_MAX_DELAY_MS,
});

function maxConfiguredRetryCount(
  semantics: FilesystemRetryCountSemantics,
): number {
  return semantics === "retries-after-initial"
    ? MAX_VERYFRONT_FILESYSTEM_RETRIES
    : MAX_GITHUB_FILESYSTEM_ATTEMPTS;
}

/** Validate and return a backend-specific filesystem retry count. */
export function requireFilesystemRetryCount(
  maxRetries: number,
  semantics: FilesystemRetryCountSemantics,
): number {
  const maximum = maxConfiguredRetryCount(semantics);
  return requireRetryCount(maxRetries, maximum, "Filesystem");
}

function requireRetryCount(
  maxRetries: number,
  maximum: number,
  subject: string,
): number {
  if (
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > maximum
  ) {
    throw new RangeError(
      `${subject} maxRetries must be a safe integer between 0 and ${maximum}`,
    );
  }
  return maxRetries;
}

function requireRetryDelay(
  value: number,
  name: "initialDelay" | "maxDelay",
  subject: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `${subject} ${name} must be a safe integer between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return value;
}

function normalizeRetryConfig(
  input: BoundedRetryConfigInput | undefined,
  defaults: BoundedRetryConfig,
  maximumRetries: number,
  subject: string,
): BoundedRetryConfig {
  const maxRetries = requireRetryCount(
    input?.maxRetries ?? defaults.maxRetries,
    maximumRetries,
    subject,
  );
  const initialDelay = requireRetryDelay(
    input?.initialDelay ?? defaults.initialDelay,
    "initialDelay",
    subject,
  );
  const maxDelay = requireRetryDelay(
    input?.maxDelay ?? defaults.maxDelay,
    "maxDelay",
    subject,
  );
  if (initialDelay > maxDelay) {
    throw new RangeError(
      `${subject} initialDelay must not exceed maxDelay`,
    );
  }
  return { maxRetries, initialDelay, maxDelay };
}

/**
 * Resolve and defensively validate filesystem retry configuration at direct
 * adapter-construction boundaries.
 */
export function normalizeFilesystemRetryConfig(
  input: FilesystemRetryConfigInput | undefined,
  defaults: FilesystemRetryConfig,
  semantics: FilesystemRetryCountSemantics,
): FilesystemRetryConfig {
  return normalizeRetryConfig(
    input,
    defaults,
    maxConfiguredRetryCount(semantics),
    "Filesystem retry",
  );
}

/**
 * Resolve public Veryfront API retry defaults and enforce the ten-attempt
 * resource boundary.
 */
export function normalizeVeryfrontApiRetryConfig(
  input: BoundedRetryConfigInput | undefined,
  defaults: BoundedRetryConfig = DEFAULT_VERYFRONT_API_RETRY_CONFIG,
): BoundedRetryConfig {
  return normalizeRetryConfig(
    input,
    defaults,
    MAX_VERYFRONT_API_RETRIES,
    "Veryfront API retry",
  );
}

/** Validate a complete retry config at an exported transport boundary. */
export function requireVeryfrontApiRetryConfig(
  config: BoundedRetryConfig,
): BoundedRetryConfig {
  if (config == null) {
    throw new RangeError("Veryfront API retry config is required");
  }
  return normalizeVeryfrontApiRetryConfig(config, config);
}

/** Convert a backend's historical retry field to its total attempt budget. */
export function filesystemTotalAttempts(
  maxRetries: number,
  semantics: FilesystemRetryCountSemantics,
): number {
  const count = requireFilesystemRetryCount(maxRetries, semantics);
  return semantics === "retries-after-initial" ? count + 1 : Math.max(1, count);
}
