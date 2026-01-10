import type { RuntimeAdapter } from "./base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";
import { createFSAdapter } from "./fs-adapter-factory.ts";
import { wrapFSAdapter } from "./fs-adapter-wrapper.ts";
import { logger } from "@veryfront/utils";

export async function enhanceAdapterWithFS(
  adapter: RuntimeAdapter,
  config: VeryfrontConfig,
  projectDir?: string,
): Promise<RuntimeAdapter> {
  if (!config.fs || config.fs.type === "local" || !config.fs.type) {
    logger.debug("[FSIntegration] Using local filesystem (default)");
    return adapter;
  }

  try {
    logger.info("[FSIntegration] Initializing FSAdapter", {
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

    logger.info("[FSIntegration] FSAdapter initialized successfully", {
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
  config: VeryfrontConfig,
): Promise<FSAdapter | null> {
  if (!config.fs || config.fs.type === "local" || !config.fs.type) {
    return Promise.resolve(null);
  }

  return createFSAdapter(config.fs as FSAdapterConfig);
}

export function isFSAdapterConfigured(config: VeryfrontConfig): boolean {
  return !!(
    config.fs &&
    config.fs.type &&
    config.fs.type !== "local"
  );
}

export function getFSAdapterType(config: VeryfrontConfig): string {
  return config.fs?.type || "local";
}
