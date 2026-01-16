import type { RuntimeAdapter } from "../base.ts";
import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createFSAdapter } from "./factory.ts";
import { wrapFSAdapter } from "./wrapper.ts";
import { logger } from "@veryfront/utils";

/**
 * Minimal config interface for FS integration.
 * Defined locally to keep adapters module isolated from core/config.
 */
interface FSIntegrationConfig {
  fs?: FSAdapterConfig;
}

export async function enhanceAdapterWithFS(
  adapter: RuntimeAdapter,
  config: FSIntegrationConfig,
  projectDir?: string,
): Promise<RuntimeAdapter> {
  if (!config.fs || config.fs.type === "local" || !config.fs.type) {
    logger.debug("[FSIntegration] Using local filesystem (default)");
    return adapter;
  }

  try {
    logger.debug("[FSIntegration] Initializing FSAdapter", {
      type: config.fs.type,
      projectSlug: config.fs.veryfront?.projectSlug,
    });

    const fsAdapterConfig: FSAdapterConfig = {
      ...config.fs as FSAdapterConfig,
      projectDir,
    };
    const fsAdapter = await createFSAdapter(fsAdapterConfig);

    const wrappedFS = wrapFSAdapter(fsAdapter);

    const enhancedAdapter: RuntimeAdapter = new Proxy(adapter, {
      get(target, prop, receiver) {
        if (prop === "fs") {
          return wrappedFS;
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    });

    logger.debug("[FSIntegration] FSAdapter initialized successfully", {
      type: config.fs.type,
    });

    return enhancedAdapter;
  } catch (error) {
    logger.error("[FSIntegration] Failed to initialize FSAdapter", {
      error: error instanceof Error ? error.message : String(error),
      type: config.fs.type,
    });

    logger.warn("[FSIntegration] Falling back to local filesystem");
    return adapter;
  }
}

export function createFSAdapterFromConfig(
  config: FSIntegrationConfig,
): Promise<FSAdapter | null> {
  if (!config.fs || config.fs.type === "local" || !config.fs.type) {
    return Promise.resolve(null);
  }

  return createFSAdapter(config.fs as FSAdapterConfig);
}

export function isFSAdapterConfigured(config: FSIntegrationConfig): boolean {
  return !!(
    config.fs &&
    config.fs.type &&
    config.fs.type !== "local"
  );
}

export function getFSAdapterType(config: FSIntegrationConfig): string {
  return config.fs?.type || "local";
}
