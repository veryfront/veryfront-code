import type { RuntimeAdapter } from "../base.ts";
import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createFSAdapter } from "./factory.ts";
import { wrapFSAdapter } from "./wrapper.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = baseLogger.component("fs-integration");

/**
 * Minimal config interface for FS integration.
 * Defined locally to keep adapters module isolated from core/config.
 */
interface FSIntegrationConfig {
  fs?: FSAdapterConfig;
}

function isLocalFS(config: FSIntegrationConfig): boolean {
  return !config.fs?.type || config.fs.type === "local";
}

export function enhanceAdapterWithFS(
  adapter: RuntimeAdapter,
  config: FSIntegrationConfig,
  projectDir?: string,
): Promise<RuntimeAdapter> {
  if (isLocalFS(config)) {
    logger.debug("Using local filesystem (default)");
    return Promise.resolve(adapter);
  }

  const fsType = config.fs?.type ?? "unknown";

  return withSpan(
    "platform.fs.enhanceAdapterWithFS",
    async () => {
      try {
        logger.debug("Initializing FSAdapter", {
          type: fsType,
          projectSlug: config.fs?.veryfront?.projectSlug,
        });

        const fsAdapterConfig: FSAdapterConfig = {
          ...config.fs,
          projectDir,
        };

        const fsAdapter = await createFSAdapter(fsAdapterConfig);
        const wrappedFS = wrapFSAdapter(fsAdapter);

        const enhancedAdapter: RuntimeAdapter = new Proxy(adapter, {
          get(target, prop, receiver) {
            if (prop === "fs") return wrappedFS;

            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });

        logger.debug("FSAdapter initialized successfully", {
          type: fsType,
        });

        return enhancedAdapter;
      } catch (error) {
        logger.error("Failed to initialize FSAdapter", {
          error: error instanceof Error ? error.message : String(error),
          type: fsType,
        });

        logger.warn("Falling back to local filesystem");
        return adapter;
      }
    },
    { "fs.adapter.type": fsType },
  );
}

export function createFSAdapterFromConfig(
  config: FSIntegrationConfig,
): Promise<FSAdapter | null> {
  if (isLocalFS(config)) return Promise.resolve(null);

  const fsType = config.fs?.type ?? "unknown";

  return withSpan(
    "platform.fs.createFSAdapterFromConfig",
    () => createFSAdapter(config.fs as FSAdapterConfig),
    { "fs.adapter.type": fsType },
  );
}

export function isFSAdapterConfigured(config: FSIntegrationConfig): boolean {
  return !!config.fs?.type && config.fs.type !== "local";
}

export function getFSAdapterType(config: FSIntegrationConfig): string {
  return config.fs?.type ?? "local";
}
