import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
import { clearConfigCache, getConfig } from "../config/index.js";
import { getErrorMessage } from "../errors/veryfront-error.js";
import { enhanceAdapterWithFS } from "../platform/adapters/fs/integration.js";
import { logger } from "../utils/index.js";
import { isDebugEnabled } from "../utils/constants/env.js";
import { loadEnv, supportsEnvFiles } from "../utils/env-loader.js";
import { getEnv } from "../platform/compat/process.js";
import { initializeEsbuild } from "../platform/compat/esbuild.js";

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

  // Initialize esbuild early - extracts binary from VFS if running as deno compile
  // This must happen before any module imports esbuild
  await initializeEsbuild();

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

  // Validate NODE_ENV in proxy mode to prevent dev behavior in production
  // @see plans/architecture-audit/014.1-node-env-missing.md
  validateProductionEnvironment(adapter);

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

/**
 * Validates that critical environment variables are set correctly in production.
 * This prevents dev behavior from accidentally being enabled in production pods.
 *
 * @see plans/architecture-audit/014.1-node-env-missing.md
 */
function validateProductionEnvironment(_adapter: RuntimeAdapter): void {
  const nodeEnv = getEnv("NODE_ENV") ?? getEnv("DENO_ENV");
  const proxyMode = getEnv("PROXY_MODE");

  // In proxy mode (deployed pods), NODE_ENV must be explicitly set to production
  if (proxyMode === "1") {
    if (!nodeEnv) {
      logger.error(
        "[Bootstrap:Prod] CRITICAL: NODE_ENV is not set in proxy mode. " +
          "This will cause isLocalDev=true, enabling dev features in production. " +
          "Set NODE_ENV=production in your pod configuration.",
      );
      throw new Error(
        "NODE_ENV must be set to 'production' when running in proxy mode (PROXY_MODE=1)",
      );
    }

    if (nodeEnv !== "production") {
      logger.warn(
        "[Bootstrap:Prod] NODE_ENV is set to '%s' in proxy mode. " +
          "Expected 'production'. This may enable dev features.",
        nodeEnv,
      );
    }
  }

  // Log effective configuration for debugging
  logger.debug("[Bootstrap:Prod] Environment configuration", {
    nodeEnv: nodeEnv ?? "(unset, defaults to development)",
    proxyMode: proxyMode ?? "0",
    isLocalDev: nodeEnv !== "production",
  });
}
