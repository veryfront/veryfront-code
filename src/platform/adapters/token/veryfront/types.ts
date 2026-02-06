/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */

import { createError, toError } from "#veryfront/errors";

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

/**
 * Configuration for token storage adapters
 */
export interface TokenStorageAdapterConfig {
  /** Storage type */
  type: "memory" | "veryfront-api";

  /** Veryfront Cloud configuration */
  veryfront?: {
    /** API token for authentication */
    apiToken?: string;
    /** Project slug */
    projectSlug?: string;
    /** API base URL (defaults to production) */
    apiBaseUrl?: string;
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

function requireVeryfrontConfig(
  config: TokenStorageAdapterConfig,
): NonNullable<TokenStorageAdapterConfig["veryfront"]> {
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
  if (!apiToken) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires apiToken",
      }),
    );
  }

  const projectSlug = veryfront.projectSlug;
  if (!projectSlug) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires projectSlug",
      }),
    );
  }

  const retry = veryfront.retry;

  return {
    apiBaseUrl: veryfront.apiBaseUrl ?? "https://api.veryfront.com",
    apiToken,
    projectSlug,
    retry: {
      maxRetries: retry?.maxRetries ?? 3,
      initialDelay: retry?.initialDelay ?? 1000,
      maxDelay: retry?.maxDelay ?? 10000,
    },
  };
}

export { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry.ts";
