/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */

import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";

/**
 * Token storage adapter interface
 *
 * Simple key-value interface for storing encrypted tokens.
 * Keys are formatted as "{userId}:{serviceId}" (e.g., "user123:gmail").
 * Values are encrypted token blobs (client encrypts before sending).
 */
export interface TokenStorageRequestOptions {
  /** Cancel the operation and any pending retry delay. */
  signal?: AbortSignal;
}

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

/**
 * Configuration for token storage adapters
 */
export interface TokenStorageAdapterConfig {
  /** Storage type */
  type?: "memory" | "veryfront-api";

  /** Veryfront Cloud configuration */
  veryfront?: {
    /** API token for authentication */
    apiToken?: string;
    /** Project slug */
    projectSlug?: string;
    /** API base URL (defaults to production) */
    apiBaseUrl?: string;
    /** Request timeout in milliseconds. Defaults to 30000ms (30 seconds). */
    timeoutMs?: number;
    /** Retry configuration */
    retry?: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
    };
  };
}

/**
 * Internal config with defaults applied
 */
export interface VeryfrontTokenConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  /** Request timeout in milliseconds. Defaults to 30000ms (30 seconds). */
  timeoutMs?: number;
  retry: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
  };
}

type ResolvedVeryfrontTokenConfig = Readonly<{
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  timeoutMs: number;
  retry: Readonly<VeryfrontTokenConfig["retry"]>;
}>;

function requireVeryfrontConfig(
  config: TokenStorageAdapterConfig,
): NonNullable<TokenStorageAdapterConfig["veryfront"]> {
  let veryfront: unknown;
  try {
    veryfront = typeof config === "object" && config !== null ? config.veryfront : undefined;
  } catch {
    throw invalidConfig("Veryfront token storage configuration must be readable");
  }

  if (typeof veryfront === "object" && veryfront !== null) {
    return veryfront as NonNullable<TokenStorageAdapterConfig["veryfront"]>;
  }

  throw invalidConfig("Veryfront token adapter requires veryfront configuration");
}

/**
 * Create verified config from adapter config
 */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_COUNT = 100;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function invalidConfig(detail: string): Error {
  return CONFIG_INVALID.create({ detail });
}

function readConfigProperty(
  config: NonNullable<TokenStorageAdapterConfig["veryfront"]>,
  property: keyof NonNullable<TokenStorageAdapterConfig["veryfront"]>,
): unknown {
  try {
    return config[property];
  } catch {
    throw invalidConfig("Veryfront token storage configuration must be readable");
  }
}

function requireCredential(value: unknown, name: "apiToken" | "projectSlug"): string {
  const label = name === "apiToken" ? "apiToken" : "projectSlug";
  if (
    typeof value !== "string" || value.length === 0 || value.trim().length === 0 ||
    value !== value.trim() || hasControlCharacters(value)
  ) {
    throw invalidConfig(`Veryfront token adapter requires a valid ${label}`);
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig("Veryfront token adapter requires a valid apiBaseUrl");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalidConfig("Veryfront token adapter requires an absolute HTTP API base URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidConfig("Veryfront token adapter API base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw invalidConfig("Veryfront token adapter API base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw invalidConfig(
      "Veryfront token adapter API base URL must not contain a query or fragment",
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return pathname ? `${url.origin}${pathname}` : url.origin;
}

function optionalInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum = MAX_TIMER_DELAY_MS,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum ||
    value > maximum
  ) {
    throw invalidConfig(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeRetry(value: unknown): ResolvedVeryfrontTokenConfig["retry"] {
  if (value !== undefined && (typeof value !== "object" || value === null)) {
    throw invalidConfig("Veryfront token adapter retry configuration must be an object");
  }

  const retry = value as Record<string, unknown> | undefined;
  let maxRetriesValue: unknown;
  let initialDelayValue: unknown;
  let maxDelayValue: unknown;
  try {
    maxRetriesValue = retry?.maxRetries;
    initialDelayValue = retry?.initialDelay;
    maxDelayValue = retry?.maxDelay;
  } catch {
    throw invalidConfig("Veryfront token adapter retry configuration must be readable");
  }

  const maxRetries = optionalInteger(
    maxRetriesValue,
    DEFAULT_MAX_RETRIES,
    "retry.maxRetries",
    0,
    MAX_RETRY_COUNT,
  );
  const initialDelay = optionalInteger(
    initialDelayValue,
    DEFAULT_INITIAL_RETRY_DELAY_MS,
    "retry.initialDelay",
    0,
  );
  const maxDelay = optionalInteger(
    maxDelayValue,
    DEFAULT_MAX_RETRY_DELAY_MS,
    "retry.maxDelay",
    0,
  );
  if (initialDelay > maxDelay) {
    throw invalidConfig("retry.initialDelay must not exceed retry.maxDelay");
  }

  return Object.freeze({ maxRetries, initialDelay, maxDelay });
}

export function createTokenConfig(
  config: TokenStorageAdapterConfig,
): ResolvedVeryfrontTokenConfig {
  const veryfront = requireVeryfrontConfig(config);
  const apiToken = requireCredential(readConfigProperty(veryfront, "apiToken"), "apiToken");
  const projectSlug = requireCredential(
    readConfigProperty(veryfront, "projectSlug"),
    "projectSlug",
  );
  const baseUrlValue = readConfigProperty(veryfront, "apiBaseUrl");
  const timeoutValue = readConfigProperty(veryfront, "timeoutMs");
  const retryValue = readConfigProperty(veryfront, "retry");

  return Object.freeze({
    apiBaseUrl: normalizeApiBaseUrl(baseUrlValue ?? "https://api.veryfront.com"),
    apiToken,
    projectSlug,
    timeoutMs: optionalInteger(
      timeoutValue,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "timeoutMs",
      1,
    ),
    retry: normalizeRetry(retryValue),
  });
}

export { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry/server.ts";
