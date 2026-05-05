import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { InvalidationProjectContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { clearConfigCache, getConfig } from "#veryfront/config";
import { type ExtensionLoader, orchestrateExtensions, tryResolve } from "veryfront/extensions";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
import { createAIProviderRegistry } from "#veryfront/extensions/registries/ai-provider-registry.ts";
import { builtinProviderExtensions } from "#veryfront/extensions/builtin-extensions.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import type { TracingExporter } from "#veryfront/extensions/interfaces/tracing-exporter.ts";
import {
  setGlobalActiveSpanAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
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

  /**
   * Extension loader that ran setup for all discovered extensions.
   * Even when no extensions exist, a loader instance is present so callers
   * can safely invoke `teardownAll()` unconditionally.
   */
  extensionLoader: ExtensionLoader;

  /**
   * Dispose bootstrap resources: tears down extensions (reverse order),
   * then releases any FSAdapter resources (WebSocket connections, caches).
   */
  dispose?: () => void | Promise<void>;
}

/**
 * Wire the `TracingExporter` contract (if registered) into the core shim.
 * Must be called after `orchestrateExtensions()` completes.
 */
/**
 * Fail-fast: ensure the `Bundler` contract has been registered. Core depends
 * on it for every JS/TS transform path. `ModuleLexer` is checked too, but
 * only as a warning (dev-only paths can degrade).
 */
function assertRequiredContracts(): void {
  if (!tryResolve("Bundler")) {
    const recommendation = getRecommendation("Bundler");
    throw MISSING_EXTENSION_ERROR.create({
      message: `Missing extension for contract "Bundler"${
        recommendation ? `. Recommended: ${recommendation}` : ""
      }`,
      detail: recommendation ? `Install it with: deno add ${recommendation}` : undefined,
    });
  }
  if (!tryResolve("ModuleLexer")) {
    bootstrapLog.warn(
      `[bootstrap] no ModuleLexer extension registered — dev-server import rewriting will fail. Recommended: ${
        getRecommendation("ModuleLexer") ?? "@veryfront/ext-esbuild"
      }`,
    );
  }
}

function wireTracingShim(): void {
  const tracing = tryResolve<TracingExporter>("TracingExporter");
  if (tracing) {
    setGlobalTracerProvider(
      tracing.getProvider() as Parameters<typeof setGlobalTracerProvider>[0],
    );
    const metricsApi = tracing.getMetricsAPI();
    if (metricsApi) {
      setGlobalMetricsAPI(
        metricsApi as Parameters<typeof setGlobalMetricsAPI>[0],
      );
    }
    const traceApi = tracing.getTraceAPI?.();
    if (traceApi) {
      setGlobalActiveSpanAccessor(
        traceApi as Parameters<typeof setGlobalActiveSpanAccessor>[0],
      );
    }
    bootstrapLog.debug("[bootstrap] TracingExporter wired into shim");
  } else {
    bootstrapLog.debug("[bootstrap] no TracingExporter extension — using no-op tracer");
  }
}

function combineDispose(
  extensionLoader: ExtensionLoader,
  fsDispose?: () => void,
): () => Promise<void> {
  return async () => {
    try {
      await extensionLoader.teardownAll();
    } finally {
      if (fsDispose) fsDispose();
    }
  };
}

/**
 * Run extension orchestration, disposing the FS adapter if orchestration fails.
 *
 * Exported for unit testing. In the FS-adapter path the caller has already
 * allocated FS resources (WebSocket connections, caches) that must be
 * released before the bootstrap error propagates.
 *
 * @internal
 */
export async function orchestrateOrDisposeFS(
  orchestrate: () => Promise<ExtensionLoader>,
  fsDispose: (() => void) | undefined,
): Promise<ExtensionLoader> {
  try {
    return await orchestrate();
  } catch (err) {
    if (fsDispose) fsDispose();
    throw err;
  }
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
    bootstrapLog.debug(`VERYFRONT_API_BASE_URL loaded from ${apiBaseUrlSource.file}`);
  }
  if (apiTokenSource.source === "env-file") {
    bootstrapLog.debug(`VERYFRONT_API_TOKEN loaded from ${apiTokenSource.file}`);
  }

  bootstrapLog.debug("API base URL", {
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
    const extensionLoader = await orchestrateExtensions({
      projectDir,
      config,
      logger: bootstrapLog,
      primeContracts: { [AIProviderRegistryName]: createAIProviderRegistry() },
      builtinExtensions: builtinProviderExtensions,
    });
    wireTracingShim();
    assertRequiredContracts();
    return {
      adapter,
      config,
      usingFSAdapter: false,
      extensionLoader,
      dispose: combineDispose(extensionLoader),
    };
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

    const extensionLoader = await orchestrateExtensions({
      projectDir,
      config,
      logger: bootstrapLog,
      primeContracts: { [AIProviderRegistryName]: createAIProviderRegistry() },
      builtinExtensions: builtinProviderExtensions,
    });
    wireTracingShim();
    assertRequiredContracts();
    return {
      adapter,
      config,
      usingFSAdapter: false,
      extensionLoader,
      dispose: combineDispose(extensionLoader),
    };
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

  let fsDispose: (() => void) | undefined;
  if (isExtendedFSAdapter(enhancedAdapter.fs)) {
    const underlying = enhancedAdapter.fs.getUnderlyingAdapter();
    if (
      "dispose" in underlying &&
      typeof (underlying as { dispose?: () => void }).dispose === "function"
    ) {
      fsDispose = () => (underlying as { dispose: () => void }).dispose();
    }
  }

  // If extension orchestration fails after the FS adapter has been wired up,
  // release the FS resources (WebSocket connections, caches) before
  // propagating the error — otherwise the adapter would leak.
  const extensionLoader = await orchestrateOrDisposeFS(
    () =>
      orchestrateExtensions({
        projectDir,
        config,
        logger: bootstrapLog,
        primeContracts: { [AIProviderRegistryName]: createAIProviderRegistry() },
      }),
    fsDispose,
  );
  wireTracingShim();
  assertRequiredContracts();

  return {
    adapter: enhancedAdapter,
    config,
    usingFSAdapter: true,
    fsAdapterType: fsType,
    extensionLoader,
    dispose: combineDispose(extensionLoader, fsDispose),
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
  const controlPlanePublicKey = getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

  // In proxy mode (deployed pods), NODE_ENV must be explicitly set to production
  if (proxyMode === "1") {
    if (!nodeEnv) {
      logger.error(
        "[Bootstrap:Prod] CRITICAL: NODE_ENV is not set in proxy mode. " +
          "Set NODE_ENV=production in your pod configuration.",
      );
      throw INVALID_ARGUMENT.create({
        detail: "NODE_ENV must be set to 'production' when running in proxy mode (PROXY_MODE=1)",
      });
    }

    if (nodeEnv !== "production") {
      logger.warn(
        "[Bootstrap:Prod] NODE_ENV is set to '%s' in proxy mode. " +
          "Expected 'production'. This may enable dev features.",
        nodeEnv,
      );
    }

    if (!controlPlanePublicKey && nodeEnv === "development") {
      logger.warn(
        "[Bootstrap:Prod] CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY is not set. " +
          "Channel dispatch verification will be unavailable (local dev mode).",
      );
    } else if (!controlPlanePublicKey) {
      logger.error(
        "[Bootstrap:Prod] CRITICAL: CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY is not set in proxy mode. " +
          "Hosted runtimes cannot verify control-plane requests without it.",
      );
      throw INVALID_ARGUMENT.create({
        detail:
          "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set when running in proxy mode (PROXY_MODE=1)",
      });
    }
  }

  // Log effective configuration for debugging
  bootstrapProdLog.debug("Environment configuration", {
    nodeEnv: nodeEnv ?? "(unset)",
    proxyMode: proxyMode ?? "0",
  });
}
