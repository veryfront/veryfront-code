/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 * For auto-detection from environment variables, use getTokenStorageAdapter()
 * from token/integration.ts instead.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-factory");

export function createTokenStorageAdapter(
  config: TokenStorageAdapterConfig,
): Promise<TokenStorageAdapter> {
  const type = config.type ?? "memory";

  return withSpan(
    "platform.token.createAdapter",
    async () => {
      logger.debug("Creating adapter", { type });

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
          message:
            `Token storage adapter type "${type}" is not implemented. Supported types: "memory", "veryfront-api".`,
        }),
      );
    },
    { "token.adapter.type": type },
  );
}
