/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 * For auto-detection from environment variables, use getTokenStorageAdapter()
 * from token/integration.ts instead.
 */

import { logger } from "@veryfront/utils";
import { createError, toError } from "../../../errors/veryfront-error.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

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
    const { MemoryTokenAdapter } = await import("./veryfront/memory-adapter.ts");
    const adapter = new MemoryTokenAdapter();
    await adapter.initialize?.();
    return adapter;
  }

  if (type === "veryfront-api") {
    const { VeryfrontTokenAdapter } = await import("./veryfront/adapter.ts");
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
