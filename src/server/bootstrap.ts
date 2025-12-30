/**
 * Bootstrap Helper
 *
 * Handles initialization order for FSAdapter and config loading.
 * Solves the chicken-and-egg problem: config determines FSAdapter, but FSAdapter is needed to load config.
 *
 * Solution:
 * 1. Load config from local filesystem first (using base RuntimeAdapter)
 * 2. Check if custom FSAdapter is configured
 * 3. If yes, create enhanced adapter with FSAdapter
 * 4. Reload config using enhanced adapter (in case config itself is remote)
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { clearConfigCache, getConfig } from "@veryfront/config";
import { enhanceAdapterWithFS } from "@veryfront/platform/adapters/fs-integration.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { logger } from "@veryfront/utils";
import { loadEnv, supportsEnvFiles } from "../core/utils/env-loader.ts";
import { isDebugEnabled } from "../core/utils/constants/env.ts";

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

/**
 * Bootstrap framework with proper initialization order
 *
 * @param projectDir - Project directory path
 * @param adapter - Base RuntimeAdapter (deno, node, bun, etc.)
 * @returns Bootstrap result with enhanced adapter and config
 */
export async function bootstrap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap] Starting framework initialization", {
    projectDir,
    runtime: adapter.platform,
  });

  // Step 0: Load environment variables from .env files (if supported)
  if (supportsEnvFiles()) {
    try {
      await loadEnv({
        cwd: projectDir,
        override: false, // Don't override existing env vars
        debug: isDebugEnabled(adapter.env),
      });
    } catch (error) {
      // Non-fatal error - log but continue
      logger.warn("[Bootstrap] Failed to load .env files", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 1: Load config using base adapter (local filesystem)
  logger.debug("[Bootstrap] Loading config with base adapter");
  let config = await getConfig(projectDir, adapter);

  // Step 2: Check if custom FSAdapter is configured
  const fsType = config.fs?.type;
  const needsFSAdapter = fsType && fsType !== "local";

  if (!needsFSAdapter) {
    logger.debug("[Bootstrap] Using local filesystem (no FSAdapter needed)");
    return {
      adapter,
      config,
      usingFSAdapter: false,
    };
  }

  // Step 3: Create enhanced adapter with FSAdapter
  logger.debug("[Bootstrap] Initializing FSAdapter", { type: fsType });
  const enhancedAdapter = await enhanceAdapterWithFS(adapter, config, projectDir);

  // Check if FSAdapter was actually initialized (enhanceAdapterWithFS returns original adapter on failure)
  const fsAdapterInitialized = enhancedAdapter !== adapter;

  // Step 4: Reload config using enhanced adapter (only if FSAdapter was initialized)
  // This allows config file itself to be served from API
  if (fsAdapterInitialized) {
    logger.debug("[Bootstrap] Reloading config with FSAdapter");
    clearConfigCache();
    const originalConfig = config;
    const reloadedConfig = await getConfig(projectDir, enhancedAdapter);
    // If FSAdapter config returns defaults (no config file in remote project),
    // keep the original local config. This happens when using veryfront-api
    // FSAdapter where the project is remote but config is local.
    const usesDefaultDevConfig = reloadedConfig.dev?.port === 3000 &&
      reloadedConfig.dev?.host === "localhost" &&
      !reloadedConfig.dev?.hmr;
    if (usesDefaultDevConfig && originalConfig.dev) {
      logger.debug("[Bootstrap] Keeping original config (FSAdapter returned defaults)");
      config = originalConfig;
    } else {
      config = reloadedConfig;
    }
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

/**
 * Bootstrap for development mode with additional logging
 */
export async function bootstrapDev(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  logger.debug("[Bootstrap:Dev] Starting development mode initialization");

  const result = await bootstrap(projectDir, adapter);

  // Log development-specific info
  if (result.usingFSAdapter) {
    logger.debug("[Bootstrap:Dev] FSAdapter active", {
      type: result.fsAdapterType,
      projectSlug: result.config.fs?.veryfront?.projectSlug,
    });
  }

  return result;
}

/**
 * Bootstrap for production mode with error handling
 */
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

    // In production, fail fast on bootstrap errors
    throw error;
  }
}
