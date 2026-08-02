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
import type {
  TokenStorageAdapter,
  TokenStorageAdapterConfig,
  VeryfrontTokenStorageOptions,
} from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-factory");

export function createTokenStorageAdapter(
  config: TokenStorageAdapterConfig,
): Promise<TokenStorageAdapter> {
  const type = config.type ?? "memory";
  const veryfront = config.veryfront;
  const veryfrontSnapshot = type === "veryfront-api" && veryfront !== undefined
    ? snapshotVeryfrontOptions(veryfront)
    : undefined;

  return withSpan(
    "platform.token.createAdapter",
    async () => {
      logger.debug("Creating adapter", { type });

      if (type === "memory") {
        if (veryfront !== undefined) {
          throw toError(
            createError({
              type: "config",
              message:
                'Veryfront token configuration requires adapter type "veryfront-api"; refusing to fall back to memory storage.',
            }),
          );
        }
        const { MemoryTokenAdapter } = await import("./veryfront/memory-adapter.ts");
        return await initializeAdapter(new MemoryTokenAdapter());
      }

      if (type === "veryfront-api") {
        if (veryfrontSnapshot === undefined) {
          throw toError(
            createError({
              type: "config",
              message: "Veryfront token adapter requires veryfront configuration",
            }),
          );
        }
        const { VeryfrontTokenAdapter } = await import("./veryfront/adapter.ts");
        return await initializeAdapter(
          new VeryfrontTokenAdapter({
            type: "veryfront-api",
            veryfront: veryfrontSnapshot,
          }),
        );
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

function snapshotVeryfrontOptions(
  options: VeryfrontTokenStorageOptions,
): VeryfrontTokenStorageOptions {
  const retry = options.retry;
  return Object.freeze({
    apiToken: options.apiToken,
    projectSlug: options.projectSlug,
    apiBaseUrl: options.apiBaseUrl,
    timeoutMs: options.timeoutMs,
    retry: retry === undefined ? undefined : Object.freeze({
      maxRetries: retry.maxRetries,
      initialDelay: retry.initialDelay,
      maxDelay: retry.maxDelay,
    }),
  });
}

async function initializeAdapter(
  adapter: TokenStorageAdapter,
): Promise<TokenStorageAdapter> {
  try {
    await adapter.initialize?.();
    return adapter;
  } catch (error) {
    try {
      adapter.dispose?.();
    } catch (cleanupError) {
      logger.warn("Failed to dispose token adapter after initialization failure", {
        cleanupError,
      });
    }
    throw error;
  }
}
