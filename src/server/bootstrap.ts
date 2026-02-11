import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { InvalidationProjectContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { clearConfigCache, getConfig } from "#veryfront/config";
import {
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { initializeEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { logger } from "#veryfront/utils";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import {
  getEnvSource,
  hasEnvLoaded,
  loadEnv,
  markEnvLoaded,
  supportsEnvFiles,
} from "#veryfront/utils/env-loader.ts";
import { ReloadNotifier } from "./reload-notifier.ts";
import { clearDomainCache } from "./utils/domain-lookup.ts";

const bootstrapLog = logger.component("bootstrap");
const bootstrapDevLog = logger.component("bootstrap-dev");
const bootstrapProdLog = logger.component("bootstrap-prod");

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

let envLogged = false;

async function ensureEnvLoaded(projectDir: string, adapter: RuntimeAdapter): Promise<void> {
  if (hasEnvLoaded()) {
    logEnvConfig();
    return;
  }

  if (supportsEnvFiles()) {
    try {
      await loadEnv({
        cwd: projectDir,
        debug: isDebugEnabled(adapter.env),
      });
      refreshEnvironmentConfig();
    } catch (error) {
      bootstrapLog.warn("Failed to load .env files", {
        error: getErrorMessage(error),
      });
    }
  }
  markEnvLoaded();
  logEnvConfig();
}

function logEnvConfig(): void {
  if (envLogged) return;
  envLogged = true;

  const envConfig = getEnvironmentConfig();
  const apiBaseUrlSource = getEnvSource("VERYFRONT_API_BASE_URL");
  const apiTokenSource = getEnvSource("VERYFRONT_API_TOKEN");

  if (apiBaseUrlSource.source === "env-file") {
    bootstrapLog.info(`VERYFRONT_API_BASE_URL loaded from ${apiBaseUrlSource.file}`);
  }
  if (apiTokenSource.source === "env-file") {
    bootstrapLog.info(`VERYFRONT_API_TOKEN loaded from ${apiTokenSource.file}`);
  }

  bootstrapLog.info("API base URL", {
    apiBaseUrl: envConfig.apiBaseUrl,
    apiBaseUrlSource,
    apiTokenPresent: Boolean(envConfig.apiToken),
    apiTokenSource,
  });
}

export async function bootstrap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  bootstrapLog.debug("Starting framework initialization", {
    projectDir,
    runtime: adapter.id,
  });

  // Initialize esbuild early - extracts binary from VFS if running as deno compile
  // This must happen before any module imports esbuild
  await initializeEsbuild();
  await ensureEnvLoaded(projectDir, adapter);

  bootstrapLog.debug("Loading config with base adapter");
  let config = await getConfig(projectDir, adapter);

  const fsType = config.fs?.type;
  const needsFSAdapter = fsType != null && fsType !== "local";

  if (!needsFSAdapter) {
    bootstrapLog.debug("Using local filesystem (no FSAdapter needed)");
    return { adapter, config, usingFSAdapter: false };
  }

  bootstrapLog.debug("Initializing FSAdapter", { type: fsType });

  // Inject server-layer callbacks into FS config so the platform layer
  // doesn't need to import from the server layer
  const fsWithCallbacks = {
    ...config.fs,
    invalidationCallbacks: {
      triggerReload: (changedPaths?: string[], project?: InvalidationProjectContext) =>
        ReloadNotifier.triggerReload(changedPaths, project),
      clearDomainCache,
    },
  };

  const enhancedAdapter = await enhanceAdapterWithFS(
    adapter,
    { ...config, fs: fsWithCallbacks },
    projectDir,
  );

  if (enhancedAdapter === adapter) {
    bootstrapLog.debug("Framework initialized successfully", {
      projectDir,
      runtime: adapter.id,
      fsAdapter: "local",
    });

    return { adapter, config, usingFSAdapter: false };
  }

  const isProxyMode = config.fs?.veryfront?.proxyMode === true;
  const isProductionMode = config.fs?.veryfront?.productionMode === true;

  if (isProxyMode) {
    bootstrapLog.debug("Skipping config reload in proxy mode (using local config)");
  } else if (isProductionMode) {
    bootstrapLog.debug("Skipping config reload in production mode (using local config)");
  } else {
    bootstrapLog.debug("Reloading config with FSAdapter");
    clearConfigCache();

    const originalConfig = config;
    const reloadedConfig = await getConfig(projectDir, enhancedAdapter);

    const usesDefaultDevConfig = reloadedConfig.dev?.port === 3000 &&
      reloadedConfig.dev?.host === "localhost" &&
      !reloadedConfig.dev?.hmr;

    if (usesDefaultDevConfig && originalConfig.dev) {
      bootstrapLog.debug("Keeping original config (FSAdapter returned defaults)");
      config = originalConfig;
    } else {
      config = reloadedConfig;
    }
  }

  bootstrapLog.debug("Framework initialized successfully", {
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
  bootstrapDevLog.debug("Starting development mode initialization");

  const result = await bootstrap(projectDir, adapter);

  if (result.usingFSAdapter) {
    bootstrapDevLog.debug("FSAdapter active", {
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
  bootstrapProdLog.debug("Starting production mode initialization");

  await ensureEnvLoaded(projectDir, adapter);

  // Validate NODE_ENV in proxy mode to prevent dev behavior in production
  // @see plans/architecture-audit/014.1-node-env-missing.md
  validateProductionEnvironment(adapter);

  try {
    const result = await bootstrap(projectDir, adapter);

    if (result.usingFSAdapter) {
      bootstrapProdLog.debug("FSAdapter initialized", {
        type: result.fsAdapterType,
      });
    }

    return result;
  } catch (error) {
    bootstrapProdLog.error("Initialization failed", {
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
  bootstrapProdLog.debug("Environment configuration", {
    nodeEnv: nodeEnv ?? "(unset)",
    proxyMode: proxyMode ?? "0",
  });
}
