/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 */

import { logger } from "@veryfront/utils";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  TokenStorageAdapter,
  TokenStorageAdapterConfig,
} from "./veryfront-token-adapter/types.ts";

/**
 * Create a token storage adapter based on configuration
 *
 * @example Veryfront Cloud
 * ```typescript
 * const adapter = await createTokenStorageAdapter({
 *   type: "veryfront-api",
 *   veryfront: {
 *     apiToken: process.env.VERYFRONT_API_TOKEN,
 *     projectSlug: "my-project",
 *   },
 * });
 * ```
 *
 * @example In-memory (development)
 * ```typescript
 * const adapter = await createTokenStorageAdapter({ type: "memory" });
 * ```
 */
export async function createTokenStorageAdapter(
  config: TokenStorageAdapterConfig,
): Promise<TokenStorageAdapter> {
  const type = config.type || "memory";

  logger.debug("[TokenAdapterFactory] Creating adapter", { type });

  if (type === "memory") {
    const { MemoryTokenAdapter } = await import(
      "./veryfront-token-adapter/memory-adapter.ts"
    );
    const adapter = new MemoryTokenAdapter();
    await adapter.initialize?.();
    return adapter;
  }

  if (type === "veryfront-api") {
    const { VeryfrontTokenAdapter } = await import(
      "./veryfront-token-adapter/adapter.ts"
    );
    const adapter = new VeryfrontTokenAdapter(config);
    await adapter.initialize?.();
    return adapter;
  }

  throw toError(
    createError({
      type: "config",
      message: `Token storage adapter type "${type}" is not implemented. ` +
        `Supported types: "memory", "veryfront-api".`,
    }),
  );
}

/**
 * Create token storage adapter from environment variables
 *
 * Automatically detects configuration from:
 * - VERYFRONT_API_TOKEN + VERYFRONT_PROJECT_SLUG → veryfront-api
 * - Otherwise → memory (development)
 */
export function createTokenStorageAdapterFromEnv(): Promise<TokenStorageAdapter> {
  const apiToken =
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Deno?.env?.get("VERYFRONT_API_TOKEN") ||
    (typeof process !== "undefined" ? process.env?.VERYFRONT_API_TOKEN : undefined);

  const projectSlug =
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Deno?.env?.get("VERYFRONT_PROJECT_SLUG") ||
    (typeof process !== "undefined" ? process.env?.VERYFRONT_PROJECT_SLUG : undefined);

  const baseUrl =
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Deno?.env?.get("VERYFRONT_API_URL") ||
    (typeof process !== "undefined" ? process.env?.VERYFRONT_API_URL : undefined);

  if (apiToken && projectSlug) {
    logger.info("[TokenAdapterFactory] Using Veryfront Cloud storage", {
      projectSlug,
    });

    return createTokenStorageAdapter({
      type: "veryfront-api",
      veryfront: {
        apiToken,
        projectSlug,
        baseUrl,
      },
    });
  }

  logger.warn(
    "[TokenAdapterFactory] No Veryfront credentials found, using in-memory storage. " +
      "Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG for production.",
  );

  return createTokenStorageAdapter({ type: "memory" });
}
