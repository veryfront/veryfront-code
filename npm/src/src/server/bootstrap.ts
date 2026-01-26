import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
import { clearConfigCache, getConfig } from "../config/index.js";
import { getErrorMessage } from "../errors/veryfront-error.js";
import { enhanceAdapterWithFS } from "../platform/adapters/fs/integration.js";
import { logger } from "../utils/index.js";
import { isDebugEnabled } from "../utils/constants/env.js";
import { loadEnv, supportsEnvFiles } from "../utils/env-loader.js";

export interface BootstrapResult {
  /** Enhanced runtime adapter (with FSAdapter if configured) */
  adapter: RuntimeAdapter;

  /** Loaded configuration */
  config: VeryfrontConfig;

  /** Whether FSAdapter was initialized */
  usingFSAdapter: boolean;

  /** FSAdapter type (if used) */
  fsAdapterType?: string;
}

export async function bootstrap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap] Starting framework initialization", {
    projectDir,
    runtime: adapter.id,
  });

  if (supportsEnvFiles()) {
    try {
      await loadEnv({
        cwd: projectDir,
        override: false,
        debug: isDebugEnabled(adapter.env),
      });
    } catch (error) {
      logger.warn("[Bootstrap] Failed to load .env files", {
        error: getErrorMessage(error),
      });
    }
  }

  logger.debug("[Bootstrap] Loading config with base adapter");
  let config = await getConfig(projectDir, adapter);

  const fsType = config.fs?.type;
  const needsFSAdapter = fsType != null && fsType !== "local";

  if (!needsFSAdapter) {
    logger.debug("[Bootstrap] Using local filesystem (no FSAdapter needed)");
    return { adapter, config, usingFSAdapter: false };
  }

  logger.debug("[Bootstrap] Initializing FSAdapter", { type: fsType });
  const enhancedAdapter = await enhanceAdapterWithFS(adapter, config, projectDir);
  const fsAdapterInitialized = enhancedAdapter !== adapter;

  const isProxyMode = config.fs?.veryfront?.proxyMode === true;
  const isProductionMode = config.fs?.veryfront?.productionMode === true;

  if (!fsAdapterInitialized) {
    logger.debug("[Bootstrap] Framework initialized successfully", {
      projectDir,
      runtime: adapter.id,
      fsAdapter: "local",
    });

    return {
      adapter,
      config,
      usingFSAdapter: false,
    };
  }

  if (isProxyMode) {
    logger.debug("[Bootstrap] Skipping config reload in proxy mode (using local config)");
  } else if (isProductionMode) {
    logger.debug("[Bootstrap] Skipping config reload in production mode (using local config)");
  } else {
    logger.debug("[Bootstrap] Reloading config with FSAdapter");
    clearConfigCache();

    const originalConfig = config;
    const reloadedConfig = await getConfig(projectDir, enhancedAdapter);

    const usesDefaultDevConfig = reloadedConfig.dev?.port === 3000 &&
      reloadedConfig.dev?.host === "localhost" &&
      !reloadedConfig.dev?.hmr;

    config = usesDefaultDevConfig && originalConfig.dev
      ? (logger.debug("[Bootstrap] Keeping original config (FSAdapter returned defaults)"),
        originalConfig)
      : reloadedConfig;
  }

  logger.debug("[Bootstrap] Framework initialized successfully", {
    projectDir,
    runtime: adapter.id,
    fsAdapter: fsType,
  });

  return {
    adapter: enhancedAdapter,
    config,
    usingFSAdapter: true,
    fsAdapterType: fsType,
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
      error: getErrorMessage(error),
    });
    throw error;
  }
}
