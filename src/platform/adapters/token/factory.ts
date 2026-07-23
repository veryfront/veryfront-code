/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 * For auto-detection from environment variables, use getTokenStorageAdapter()
 * from token/integration.ts instead.
 */

import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-factory");

export async function createTokenStorageAdapter(
  config: TokenStorageAdapterConfig = {},
): Promise<TokenStorageAdapter> {
  const type = resolveAdapterType(config);

  return await withSpan(
    "platform.token.createAdapter",
    async () => {
      logger.debug("Creating adapter", { type });

      if (type === "memory") {
        const { MemoryTokenAdapter } = await import("./veryfront/memory-adapter.ts");
        const adapter = new MemoryTokenAdapter();
        return await initializeAdapter(adapter);
      }

      const { VeryfrontTokenAdapter } = await import("./veryfront/adapter.ts");
      const adapter = new VeryfrontTokenAdapter(config);
      return await initializeAdapter(adapter);
    },
    { "token.adapter.type": type },
  );
}

function resolveAdapterType(
  config: TokenStorageAdapterConfig,
): "memory" | "veryfront-api" {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw CONFIG_INVALID.create({
      detail: "Token storage adapter configuration must be an object",
    });
  }

  let type: unknown;
  try {
    type = config.type;
  } catch {
    throw CONFIG_INVALID.create({
      detail: "Token storage adapter configuration must be readable",
    });
  }

  if (type === undefined || type === "memory") return "memory";
  if (type === "veryfront-api") return type;
  throw CONFIG_INVALID.create({
    detail: 'Unsupported token storage adapter type. Use "memory" or "veryfront-api"',
  });
}

async function initializeAdapter<T extends TokenStorageAdapter>(adapter: T): Promise<T> {
  try {
    await adapter.initialize?.();
    return adapter;
  } catch (error) {
    try {
      adapter.dispose?.();
    } catch {
      logger.error("Token storage adapter cleanup failed after initialization error");
    }
    throw error;
  }
}
