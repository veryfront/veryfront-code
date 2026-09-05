/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */

import { createError, toError } from "#veryfront/errors";
import { normalizeVeryfrontApiRetryConfig } from "#veryfront/utils/config-resource-limits.ts";
import { normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";

export const DEFAULT_TOKEN_STORAGE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKEN_STORAGE_KEY_CODE_UNITS = 4_096;
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;

/**
 * Token storage adapter interface
 *
 * Simple key-value interface for storing encrypted tokens.
 * Keys are formatted as "{userId}:{serviceId}" (e.g., "user123:gmail").
 * Values are encrypted token blobs (client encrypts before sending).
 */
export interface TokenStorageAdapter {
  /** Get encrypted token by key */
  get(key: string): Promise<string | null>;

  /** Set encrypted token by key (upsert) */
  set(key: string, value: string): Promise<void>;

  /** Delete token by key (idempotent) */
  delete(key: string): Promise<void>;

  /** List all keys with optional prefix filter */
  list?(prefix?: string): Promise<string[]>;

  /** Initialize the adapter (e.g., verify connection) */
  initialize?(): Promise<void>;

  /** Cleanup resources */
  dispose?(): void;
}

/** Veryfront Cloud token-storage options. */
export interface VeryfrontTokenStorageOptions {
  /** API token for authentication */
  apiToken: string;
  /** Project slug */
  projectSlug: string;
  /** API base URL (defaults to production) */
  apiBaseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000ms. */
  timeoutMs?: number;
  /** Retry configuration */
  retry?: {
    /** Retries after the initial request, from 0 through 9. */
    maxRetries?: number;
    /** Initial retry delay in whole milliseconds. */
    initialDelay?: number;
    /** Maximum retry delay in whole milliseconds. */
    maxDelay?: number;
  };
}

/**
 * Configuration for token storage adapters.
 *
 * The discriminator is optional only for the empty/default memory config.
 * Cloud options can never be combined with, or silently downgraded to, the
 * in-memory adapter.
 */
export type TokenStorageAdapterConfig =
  | { type?: "memory"; veryfront?: never }
  | { type: "veryfront-api"; veryfront: VeryfrontTokenStorageOptions };

/**
 * Internal config with defaults applied
 */
export interface VeryfrontTokenConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  retry: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
  };
}

function requireVeryfrontConfig(
  config: TokenStorageAdapterConfig,
): VeryfrontTokenStorageOptions {
  const veryfront = config.veryfront;
  if (veryfront) return veryfront;

  throw toError(
    createError({
      type: "config",
      message: "Veryfront token adapter requires veryfront configuration",
    }),
  );
}

/**
 * Create verified config from adapter config
 */
export function createTokenConfig(config: TokenStorageAdapterConfig): VeryfrontTokenConfig {
  const veryfront = requireVeryfrontConfig(config);

  const apiToken = veryfront.apiToken;
  if (!isNonBlankString(apiToken)) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires apiToken",
      }),
    );
  }

  const projectSlug = veryfront.projectSlug;
  if (!isNonBlankString(projectSlug)) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires projectSlug",
      }),
    );
  }

  return {
    apiBaseUrl: veryfront.apiBaseUrl ?? "https://api.veryfront.com",
    apiToken,
    projectSlug,
    timeoutMs: normalizeTimerDurationMs(
      veryfront.timeoutMs ?? DEFAULT_TOKEN_STORAGE_REQUEST_TIMEOUT_MS,
      "Token storage timeoutMs",
    ),
    retry: normalizeVeryfrontApiRetryConfig(veryfront.retry),
  };
}

export function assertTokenStorageKey(key: string): void {
  assertBoundedTokenStorageIdentifier(key, "key", false);
}

export function assertTokenStoragePrefix(prefix: string | undefined): void {
  if (prefix === undefined) return;
  assertBoundedTokenStorageIdentifier(prefix, "prefix", true);
}

export function assertTokenStorageValue(value: string): void {
  if (typeof value !== "string") {
    throw new TypeError("Token storage value must be a string");
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" &&
    (applyIntrinsic(stringTrim, value, []) as string).length > 0;
}

function assertBoundedTokenStorageIdentifier(
  value: string,
  label: "key" | "prefix",
  allowEmpty: boolean,
): void {
  if (typeof value !== "string") {
    throw new TypeError(`Token storage ${label} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new TypeError("Token storage key must be non-empty");
  }
  if (value.length > MAX_TOKEN_STORAGE_KEY_CODE_UNITS) {
    throw new RangeError(
      `Token storage ${label} must not exceed ${MAX_TOKEN_STORAGE_KEY_CODE_UNITS} code units`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      throw new TypeError(`Token storage ${label} must not contain control characters`);
    }
  }
}

export { TOKEN_STORAGE_ERROR } from "#veryfront/errors";
