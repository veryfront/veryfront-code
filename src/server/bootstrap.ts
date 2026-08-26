import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type {
  FSAdapterConfig,
  InvalidationProjectContext,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { clearConfigCache, getConfig } from "#veryfront/config";
import { type ExtensionLoader, orchestrateExtensions, tryResolve } from "veryfront/extensions";
import {
  createEvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "#veryfront/extensions/eval/index.ts";
import {
  createLLMProviderRegistry,
  LLMProviderRegistryName,
} from "#veryfront/extensions/llm/index.ts";
import {
  createBuiltinExtensions,
  ensureBuiltinSchemaValidator,
} from "#veryfront/extensions/builtin-extensions.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  type NodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
  snapshotNodeWebSocketServerProvider,
} from "#veryfront/extensions/websocket";
import {
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getErrorMessage, INVALID_ARGUMENT } from "#veryfront/errors";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import { initializeEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { __registerLogRecordEmitter, logger } from "#veryfront/utils/logger/logger.ts";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import {
  getEnvSource,
  hasEnvLoaded,
  loadEnv,
  markEnvLoaded,
  supportsEnvFiles,
} from "#veryfront/utils/env-loader.ts";
import {
  createFileLogSubscriber,
  type FileLogConfig,
  type FileLogSubscriber,
} from "#veryfront/observability";
import { getLogBuffer } from "#veryfront/observability/log-buffer.ts";
import { ReloadNotifier } from "./reload-notifier.ts";
import {
  createServerStyleCallbacks,
  createServerStyleInvalidationCallbacks,
} from "./style-callbacks.ts";
import { clearDomainCache } from "./utils/domain-lookup.ts";
import { getMissingProjectEnvInternalCredentialDetail } from "./project-env/internal-authorization.ts";

const bootstrapLog = logger.component("bootstrap");
const bootstrapDevLog = logger.component("bootstrap-dev");
const bootstrapProdLog = logger.component("bootstrap-prod");
const LOCAL_CLI_PROXY_MODE_ENV = "VERYFRONT_CLI_LOCAL_PROXY_MODE";

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

  /** Immutable Node WebSocket implementation selected by this extension generation. */
  nodeWebSocketServerProvider?: Readonly<NodeWebSocketServerProvider>;

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
        getRecommendation("ModuleLexer") ?? "@veryfront/ext-bundler-esbuild"
      }`,
    );
  }
}

export function wireTracingShim(): void {
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
    const contextApi = tracing.getContextAPI?.();
    if (contextApi) {
      setGlobalContextAccessor(
        contextApi as Parameters<typeof setGlobalContextAccessor>[0],
      );
    }
    const logRecordEmitter = tracing.getLogRecordEmitter?.();
    __registerLogRecordEmitter(logRecordEmitter ?? null);
    bootstrapLog.debug("[bootstrap] TracingExporter wired into shim");
  } else {
    __registerLogRecordEmitter(null);
    bootstrapLog.debug("[bootstrap] no TracingExporter extension — using no-op tracer");
  }
}

function createBootstrapPrimeContracts(): Record<string, unknown> {
  return {
    [LLMProviderRegistryName]: createLLMProviderRegistry(),
    [EvalReportExporterRegistryName]: createEvalReportExporterRegistry(),
  };
}

/** @internal Snapshot the extension-provided Node WebSocket implementation for this generation. */
export function resolveNodeWebSocketServerProviderForBootstrap():
  | Readonly<NodeWebSocketServerProvider>
  | undefined {
  const provider = tryResolve<unknown>(NodeWebSocketServerProviderName);
  return provider === undefined ? undefined : snapshotNodeWebSocketServerProvider(provider);
}

const DEFAULT_FILE_LOG_PATH = ".veryfront/logs/server.log";
const DEFAULT_FILE_LOG_MAX_SIZE = "10mb";
const DEFAULT_FILE_LOG_MAX_FILES = 5;
const DEFAULT_FILE_LOG_LEVEL = "warn" as const;
const DEFAULT_FILE_LOG_FORMAT = "json" as const;

export interface FileLogHandle {
  subscriber: FileLogSubscriber;
  unsubscribe: () => void;
}

function maybeAttachFileLogSubscriber(config: VeryfrontConfig): FileLogHandle | null {
  const fileConfig = config.observability?.logging?.file;
  if (!fileConfig?.enabled) return null;

  const resolved: FileLogConfig = {
    enabled: true,
    path: fileConfig.path ?? DEFAULT_FILE_LOG_PATH,
    maxSize: fileConfig.maxSize ?? DEFAULT_FILE_LOG_MAX_SIZE,
    maxFiles: fileConfig.maxFiles ?? DEFAULT_FILE_LOG_MAX_FILES,
    level: (fileConfig.level ?? DEFAULT_FILE_LOG_LEVEL) as "debug" | "info" | "warn" | "error",
    format: (fileConfig.format ?? DEFAULT_FILE_LOG_FORMAT) as "text" | "json",
  };

  const subscriber = createFileLogSubscriber(resolved);
  const unsubscribe = getLogBuffer().subscribe(subscriber.getSubscriber());
  bootstrapLog.debug("[bootstrap] File log subscriber attached", {
    path: resolved.path,
    level: resolved.level,
    format: resolved.format,
  });
  return { subscriber, unsubscribe };
}

/**
 * Detach the file log, absorbing teardown failures.
 *
 * `flush()`/`close()` reject so explicit callers can react to dropped log
 * writes, but bootstrap only detaches a best-effort log sink. Propagating here
 * would fail a config reload over a retained write error, or replace the real
 * startup error on the failure path with the teardown rejection.
 */
export async function teardownFileLog(handle: FileLogHandle | null): Promise<void> {
  if (!handle) return;
  try {
    handle.unsubscribe();
  } catch (error) {
    bootstrapLog.warn("[bootstrap] Failed to detach file log subscriber", { error });
  }
  try {
    await handle.subscriber.close();
  } catch (error) {
    bootstrapLog.warn("[bootstrap] Failed to close file log subscriber", { error });
  }
}

function combineDispose(
  extensionLoader: ExtensionLoader,
  fsDispose?: () => void,
  fileLogHandle?: FileLogHandle | null,
): () => Promise<void> {
  return async () => {
    try {
      await extensionLoader.teardownAll();
    } finally {
      try {
        await teardownFileLog(fileLogHandle ?? null);
      } finally {
        try {
          __registerLogRecordEmitter(null);
        } finally {
          if (fsDispose) fsDispose();
        }
      }
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
    if (fsDispose) {
      try {
        fsDispose();
      } catch (disposeError) {
        bootstrapLog.warn(
          "[bootstrap] Failed to dispose the FS adapter after orchestration failed",
          {
            error: getErrorMessage(disposeError),
          },
        );
      }
    }
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
  ensureBuiltinSchemaValidator();

  bootstrapLog.debug("Loading config with base adapter");
  let config = await getConfig(projectDir, adapter);

  let fileLog = maybeAttachFileLogSubscriber(config);

  try {
    const fsType = config.fs?.type;
    const needsFSAdapter = fsType != null && fsType !== "local";

    if (!needsFSAdapter) {
      bootstrapLog.debug("Using local filesystem (no FSAdapter needed)");
      const extensionLoader = await orchestrateExtensions({
        projectDir,
        config,
        logger: bootstrapLog,
        primeContracts: createBootstrapPrimeContracts(),
        builtinExtensions: createBuiltinExtensions(),
        setupTimeoutMs: getEnvironmentConfig().extensionSetupTimeoutMs,
      });
      wireTracingShim();
      assertRequiredContracts();
      const nodeWebSocketServerProvider = resolveNodeWebSocketServerProviderForBootstrap();
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader,
        ...(nodeWebSocketServerProvider === undefined ? {} : { nodeWebSocketServerProvider }),
        dispose: combineDispose(extensionLoader, undefined, fileLog),
      };
    }

    bootstrapLog.debug("Initializing FSAdapter", { type: fsType });

    // Inject server-layer callbacks into FS config so the platform layer
    // doesn't need to import from the server layer
    const configuredFs = (config.fs ?? {}) as Partial<FSAdapterConfig>;
    const fsWithCallbacks: FSAdapterConfig = {
      ...configuredFs,
      invalidationCallbacks: {
        ...createServerStyleInvalidationCallbacks(),
        ...configuredFs.invalidationCallbacks,
        triggerReload: (changedPaths?: string[], project?: InvalidationProjectContext) =>
          ReloadNotifier.triggerReload(changedPaths, project),
        clearDomainCache,
      },
      styleCallbacks: {
        ...createServerStyleCallbacks(),
        ...configuredFs.styleCallbacks,
      },
    };

    const enhancedAdapter = await enhanceAdapterWithFS(
      adapter,
      { fs: fsWithCallbacks },
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
        primeContracts: createBootstrapPrimeContracts(),
        builtinExtensions: createBuiltinExtensions(),
        setupTimeoutMs: getEnvironmentConfig().extensionSetupTimeoutMs,
      });
      wireTracingShim();
      assertRequiredContracts();
      const nodeWebSocketServerProvider = resolveNodeWebSocketServerProviderForBootstrap();
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader,
        ...(nodeWebSocketServerProvider === undefined ? {} : { nodeWebSocketServerProvider }),
        dispose: combineDispose(extensionLoader, undefined, fileLog),
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

      // HEURISTIC: detect whether FSAdapter returned a "default dev config" (i.e., the remote
      // source had no config file) by checking for the exact default values veryfront uses when
      // no config is found. Known limitation: a user whose real config happens to use port=3000,
      // host=localhost, and no HMR block will have their config silently discarded here.
      // A future improvement would be for FSAdapter to return an explicit "config not found"
      // signal instead of the default-value object.
      const usesDefaultDevConfig = reloadedConfig.dev?.port === 3000 &&
        reloadedConfig.dev?.host === "localhost" &&
        !reloadedConfig.dev?.hmr;

      if (usesDefaultDevConfig && originalConfig.dev) {
        bootstrapLog.debug("Keeping original config (FSAdapter returned defaults)");
        config = originalConfig;
      } else {
        config = reloadedConfig;
      }

      // Re-attach file log subscriber if config was reloaded with different settings
      const newFileLog = maybeAttachFileLogSubscriber(config);
      if (newFileLog) {
        await teardownFileLog(fileLog);
        fileLog = newFileLog;
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
          primeContracts: createBootstrapPrimeContracts(),
          builtinExtensions: createBuiltinExtensions(),
          setupTimeoutMs: getEnvironmentConfig().extensionSetupTimeoutMs,
        }),
      fsDispose,
    );
    wireTracingShim();
    assertRequiredContracts();
    const nodeWebSocketServerProvider = resolveNodeWebSocketServerProviderForBootstrap();

    return {
      adapter: enhancedAdapter,
      config,
      usingFSAdapter: true,
      fsAdapterType: fsType,
      extensionLoader,
      ...(nodeWebSocketServerProvider === undefined ? {} : { nodeWebSocketServerProvider }),
      dispose: combineDispose(extensionLoader, fsDispose, fileLog),
    };
  } catch (err) {
    await teardownFileLog(fileLog);
    throw err;
  }
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
  validateProductionEnvironment();

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
function validateProductionEnvironment(): void {
  const nodeEnv = getEnv("NODE_ENV") ?? getEnv("DENO_ENV");
  const proxyMode = getEnv("PROXY_MODE");
  const localCliProxyMode = getHostEnv(LOCAL_CLI_PROXY_MODE_ENV) === "1" &&
    getEnvSource(LOCAL_CLI_PROXY_MODE_ENV).source === "process";
  const controlPlanePublicKey = getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

  // In proxy mode (deployed pods), NODE_ENV must be explicitly set to production
  if (proxyMode === "1") {
    if (localCliProxyMode) {
      bootstrapProdLog.debug("Environment configuration", {
        nodeEnv: nodeEnv ?? "(unset)",
        proxyMode,
      });
      return;
    }

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
        `[Bootstrap:Prod] NODE_ENV is set to '${nodeEnv}' in proxy mode. ` +
          "Expected 'production'. This may enable dev features.",
      );
    }

    if (!controlPlanePublicKey) {
      logger.error(
        "[Bootstrap:Prod] CRITICAL: CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY is not set in proxy mode. " +
          "Hosted runtimes cannot verify control-plane requests without it.",
      );
      throw INVALID_ARGUMENT.create({
        detail:
          "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set when running in proxy mode (PROXY_MODE=1)",
      });
    }

    const missingInternalCredentials = getMissingProjectEnvInternalCredentialDetail();
    if (missingInternalCredentials) {
      logger.error(
        `[Bootstrap:Prod] CRITICAL: ${missingInternalCredentials}.`,
      );
      throw INVALID_ARGUMENT.create({ detail: missingInternalCredentials });
    }

    if (!isProxyTopologyTrusted()) {
      logger.error(
        "[Bootstrap:Prod] CRITICAL: proxy mode does not trust its upstream topology. " +
          "Set VERYFRONT_TRUST_FORWARDED_HEADERS=1 only when this process is private behind a sanitising edge. " +
          "Existing hosted deployments must set this variable on the runtime environment before rolling out " +
          "this version, and must upgrade the proxy tier before (or together with) the runtime tier. " +
          "See src/security/README.md, 'Rollout ordering for hosted identity changes'.",
      );
      throw INVALID_ARGUMENT.create({
        detail:
          "VERYFRONT_TRUST_FORWARDED_HEADERS must be exactly '1' for hosted proxy mode behind a sanitising edge",
      });
    }
  }

  // Log effective configuration for debugging
  bootstrapProdLog.debug("Environment configuration", {
    nodeEnv: nodeEnv ?? "(unset)",
    proxyMode: proxyMode ?? "0",
  });
}

export function validateProductionEnvironmentForTests(): void {
  validateProductionEnvironment();
}
