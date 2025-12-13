
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { clearConfigCache, getConfig } from "@veryfront/config";
import { enhanceAdapterWithFS } from "@veryfront/platform/adapters/fs-integration.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { logger } from "@veryfront/utils";
import { loadEnv, supportsEnvFiles } from "../core/utils/env-loader.ts";
import { isDebugEnabled } from "../core/utils/constants/env.ts";

export interface BootstrapResult {
  adapter: RuntimeAdapter;

  config: VeryfrontConfig;

  usingFSAdapter: boolean;

  fsAdapterType?: string;
}

export async function bootstrap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap] Starting framework initialization", {
    projectDir,
    runtime: adapter.platform,
  });

  if (supportsEnvFiles()) {
    try {
      await loadEnv({
        cwd: projectDir,
        override: false, // Don't override existing env vars
        debug: isDebugEnabled(adapter.env),
      });
    } catch (error) {
      logger.warn("[Bootstrap] Failed to load .env files", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.debug("[Bootstrap] Loading config with base adapter for projectDir:", projectDir);
  let config = await getConfig(projectDir, adapter);

  const fsType = config.fs?.type;
  const needsFSAdapter = fsType && fsType !== "local";

  logger.debug("[Bootstrap] Config loaded", { fsType, needsFSAdapter, hasFs: !!config.fs });

  if (!needsFSAdapter) {
    logger.debug("[Bootstrap] Using local filesystem (no FSAdapter needed)");
    return {
      adapter,
      config,
      usingFSAdapter: false,
    };
  }

  logger.debug("[Bootstrap] Initializing FSAdapter", { type: fsType });
  const enhancedAdapter = await enhanceAdapterWithFS(adapter, config, projectDir);

  const fsAdapterInitialized = enhancedAdapter !== adapter;

  if (fsAdapterInitialized) {
    logger.debug("[Bootstrap] Reloading config with FSAdapter");
    clearConfigCache();
    config = await getConfig(projectDir, enhancedAdapter);
  }

  logger.debug("[Bootstrap] Framework initialized successfully", {
    projectDir,
    runtime: adapter.platform,
    fsAdapter: fsAdapterInitialized ? fsType : "local",
  });

  return {
    adapter: fsAdapterInitialized ? enhancedAdapter : adapter,
    config,
    usingFSAdapter: fsAdapterInitialized,
    fsAdapterType: fsAdapterInitialized ? fsType : undefined,
  };
}

export async function bootstrapDev(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap:Dev] Starting development mode initialization");

  const result = await bootstrap(projectDir, adapter);

  if (result.usingFSAdapter) {
    logger.debug("[Bootstrap:Dev] FSAdapter active", {
      type: result.fsAdapterType,
      projectSlug: result.config.fs?.veryfront?.projectSlug,
    });
  }

  return result;
}

export async function bootstrapProd(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap:Prod] Starting production mode initialization");

  try {
    const result = await bootstrap(projectDir, adapter);

    if (result.usingFSAdapter) {
      logger.debug("[Bootstrap:Prod] FSAdapter initialized", {
        type: result.fsAdapterType,
      });
    }

    return result;
  } catch (error) {
    logger.error("[Bootstrap:Prod] Initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
