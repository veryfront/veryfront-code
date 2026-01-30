/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */

import { createError, toError } from "../../../../errors/index.js";

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
    baseUrl?: string;
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
  if (!config.veryfront) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires veryfront configuration",
      }),
    );
  }

  return config.veryfront;
}

/**
 * Create verified config from adapter config
 */
export function createTokenConfig(config: TokenStorageAdapterConfig): VeryfrontTokenConfig {
  const veryfront = requireVeryfrontConfig(config);

  if (!veryfront.apiToken) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires apiToken",
      }),
    );
  }

  if (!veryfront.projectSlug) {
    throw toError(
      createError({
        type: "config",
        message: "Veryfront token adapter requires projectSlug",
      }),
    );
  }

  return {
    apiBaseUrl: veryfront.baseUrl || "https://api.veryfront.com",
    apiToken: veryfront.apiToken,
    projectSlug: veryfront.projectSlug,
    retry: {
      maxRetries: veryfront.retry?.maxRetries ?? 3,
      initialDelay: veryfront.retry?.initialDelay ?? 1000,
      maxDelay: veryfront.retry?.maxDelay ?? 10000,
    },
  };
}

/**
 * Error thrown by token storage operations
 */
export class TokenStorageError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TokenStorageError";
  }
}
