/**
 * Token Storage Adapter Integration
 *
 * Provides singleton access to the token storage adapter.
 * Auto-detects configuration from environment variables.
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

// Singleton adapter instance
let tokenStorageAdapter: TokenStorageAdapter | null = null;

/**
 * Get or create the token storage adapter
 *
 * Uses singleton pattern to share adapter across the application.
 * Configuration is auto-detected from environment variables.
 */
export function getTokenStorageAdapter(): Promise<TokenStorageAdapter> {
  if (tokenStorageAdapter) {
    return Promise.resolve(tokenStorageAdapter);
  }

  return withSpan("platform.token.getTokenStorageAdapter", async () => {
    const adapterConfig = buildAdapterConfigFromEnv();
    tokenStorageAdapter = await createTokenStorageAdapter(adapterConfig);
    return tokenStorageAdapter;
  }, { "token.storage.type": getTokenStorageType() });
}

/**
 * Check if token storage is configured for production (Veryfront Cloud)
 */
export function isTokenStorageConfigured(): boolean {
  const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
  const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");

  return !!(apiToken && projectSlug);
}

/**
 * Get the current token storage type
 */
export function getTokenStorageType(): string {
  if (isTokenStorageConfigured()) {
    return "veryfront-api";
  }
  return "memory";
}

/**
 * Reset the singleton adapter (for testing)
 */
export function resetTokenStorageAdapter(): void {
  if (tokenStorageAdapter?.dispose) {
    tokenStorageAdapter.dispose();
  }
  tokenStorageAdapter = null;
}

/**
 * Build adapter config from environment variables
 */
function buildAdapterConfigFromEnv(): TokenStorageAdapterConfig {
  const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
  const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");
  const baseUrl = getEnvVar("VERYFRONT_API_URL");

  if (apiToken && projectSlug) {
    logger.debug("[TokenAdapterIntegration] Using Veryfront Cloud storage", {
      projectSlug,
    });

    return {
      type: "veryfront-api",
      veryfront: {
        apiToken,
        projectSlug,
        baseUrl,
      },
    };
  }

  logger.debug("[TokenAdapterIntegration] Using in-memory storage (development)");

  return { type: "memory" };
}

/** Global interface for Deno environment access */
interface GlobalWithDenoEnv {
  Deno?: {
    env?: {
      get(name: string): string | undefined;
    };
  };
}

/**
 * Get environment variable (works in both Deno and Node)
 */
function getEnvVar(name: string): string | undefined {
  return (globalThis as unknown as GlobalWithDenoEnv).Deno?.env?.get(name) ||
    (typeof process !== "undefined" ? process.env?.[name] : undefined);
}
