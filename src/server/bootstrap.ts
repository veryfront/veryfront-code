import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
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
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { initializeEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { __registerLogRecordEmitter, logger } from "#veryfront/utils";
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
  getLogBuffer,
} from "#veryfront/observability";
import { ReloadNotifier } from "./reload-notifier.ts";
import {
  createServerStyleCallbacks,
  createServerStyleInvalidationCallbacks,
} from "./style-callbacks.ts";
import { clearDomainCache } from "./utils/domain-lookup.ts";
import { getSafeErrorName } from "./utils/error-name.ts";

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
      `[bootstrap] no ModuleLexer extension registered. Dev-server import rewriting will fail. Recommended: ${
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
    __registerLogRecordEmitter(
      logRecordEmitter ? (entry) => logRecordEmitter({ ...entry }) : null,
    );
    bootstrapLog.debug("[bootstrap] TracingExporter wired into shim");
  } else {
    __registerLogRecordEmitter(null);
    bootstrapLog.debug("[bootstrap] no TracingExporter extension. Using no-op tracer");
  }
}

function createBootstrapPrimeContracts(): Record<string, unknown> {
  return {
    [LLMProviderRegistryName]: createLLMProviderRegistry(),
    [EvalReportExporterRegistryName]: createEvalReportExporterRegistry(),
  };
}

const DEFAULT_FILE_LOG_PATH = ".veryfront/logs/server.log";
const DEFAULT_FILE_LOG_MAX_SIZE = "10mb";
const DEFAULT_FILE_LOG_MAX_FILES = 5;
const DEFAULT_FILE_LOG_LEVEL = "warn" as const;
const DEFAULT_FILE_LOG_FORMAT = "json" as const;

interface FileLogHandle {
  subscriber: FileLogSubscriber;
  unsubscribe: () => void;
  closePromise?: Promise<void>;
}

export interface BootstrapCleanupActions {
  teardownExtensions: () => void | Promise<void>;
  teardownFileLog?: () => void | Promise<void>;
  clearTracing?: () => void | Promise<void>;
  disposeFileSystem?: () => void | Promise<void>;
}

export function getFileLogAttachmentLogContext(
  config: Pick<FileLogConfig, "path" | "level" | "format">,
  customPath: boolean,
): { customPath: boolean; level: FileLogConfig["level"]; format: FileLogConfig["format"] } {
  return {
    customPath,
    level: config.level,
    format: config.format,
  };
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
  bootstrapLog.debug(
    "[bootstrap] File log subscriber attached",
    getFileLogAttachmentLogContext(resolved, fileConfig.path !== undefined),
  );
  return { subscriber, unsubscribe };
}

async function teardownFileLog(handle: FileLogHandle | null): Promise<void> {
  if (!handle) return;
  if (!handle.closePromise) {
    handle.closePromise = (async () => {
      const failures: unknown[] = [];
      try {
        handle.unsubscribe();
      } catch (error) {
        failures.push(error);
      }
      try {
        await handle.subscriber.close();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "File log cleanup failed");
      }
    })();
  }
  await handle.closePromise;
}

async function replaceFileLogSubscriber(
  current: FileLogHandle | null,
  config: VeryfrontConfig,
): Promise<FileLogHandle | null> {
  const replacement = maybeAttachFileLogSubscriber(config);
  try {
    await teardownFileLog(current);
  } catch (error) {
    try {
      await teardownFileLog(replacement);
    } catch (replacementError) {
      throw new AggregateError(
        [error, replacementError],
        "Failed to replace the file log subscriber",
      );
    }
    throw error;
  }
  return replacement;
}

/** Build an ordered, idempotent bootstrap cleanup operation. */
export function createBootstrapDisposer(
  actions: BootstrapCleanupActions,
): () => Promise<void> {
  let disposePromise: Promise<void> | undefined;

  return () => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      const failures: unknown[] = [];
      for (
        const action of [
          actions.teardownExtensions,
          actions.teardownFileLog,
          actions.clearTracing,
          actions.disposeFileSystem,
        ]
      ) {
        if (!action) continue;
        try {
          await action();
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length > 0) {
        throw new AggregateError(failures, "Bootstrap cleanup failed");
      }
    })();
    return disposePromise;
  };
}

function combineDispose(
  extensionLoader: ExtensionLoader,
  fsDispose?: () => void | Promise<void>,
  fileLogHandle?: FileLogHandle | null,
): () => Promise<void> {
  return createBootstrapDisposer({
    teardownExtensions: () => extensionLoader.teardownAll(),
    teardownFileLog: () => teardownFileLog(fileLogHandle ?? null),
    clearTracing: () => __registerLogRecordEmitter(null),
    disposeFileSystem: fsDispose,
  });
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
  fsDispose: (() => void | Promise<void>) | undefined,
): Promise<ExtensionLoader> {
  try {
    return await orchestrate();
  } catch (err) {
    try {
      await fsDispose?.();
    } catch (cleanupError) {
      bootstrapLog.warn("Failed to dispose the filesystem after extension setup failed", {
        errorName: getSafeErrorName(cleanupError),
      });
    }
    throw err;
  }
}

/** Check virtual-project config presence without guessing from loaded values. */
export async function hasVirtualConfigFile(
  fs: Pick<FileSystemAdapter, "exists">,
): Promise<boolean> {
  for (const filename of VERYFRONT_CONFIG_FILES) {
    if (await fs.exists(`/${filename}`)) return true;
  }
  return false;
}

function getFileSystemDisposer(
  adapter: RuntimeAdapter,
): (() => void | Promise<void>) | undefined {
  if (!isExtendedFSAdapter(adapter.fs)) return undefined;
  const underlying = adapter.fs.getUnderlyingAdapter();
  const dispose = (underlying as { dispose?: () => void | Promise<void> }).dispose;
  return typeof dispose === "function" ? () => dispose.call(underlying) : undefined;
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
        errorName: getSafeErrorName(error),
      });
      throw error;
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

  bootstrapLog.debug("Environment configuration loaded", {
    apiBaseUrlPresent: Boolean(envConfig.apiBaseUrl),
    apiBaseUrlSource: apiBaseUrlSource.source,
    apiTokenPresent: Boolean(envConfig.apiToken),
    apiTokenSource: apiTokenSource.source,
  });
}

export async function bootstrap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<BootstrapResult> {
  bootstrapLog.debug("Starting framework initialization", {
    projectDirectoryPresent: Boolean(projectDir),
    runtime: adapter.id,
  });

  // Initialize esbuild early - extracts binary from VFS if running as deno compile
  // This must happen before any module imports esbuild
  await initializeEsbuild();
  await ensureEnvLoaded(projectDir, adapter);
  ensureBuiltinSchemaValidator();

  bootstrapLog.debug("Loading config with base adapter");
  let config = await getConfig(projectDir, adapter);
  let fileLog: FileLogHandle | null = null;
  let extensionLoader: ExtensionLoader | undefined;
  let fsDispose: (() => void | Promise<void>) | undefined;

  try {
    fileLog = maybeAttachFileLogSubscriber(config);

    const setupExtensions = async (): Promise<ExtensionLoader> => {
      extensionLoader = await orchestrateExtensions({
        projectDir,
        config,
        logger: bootstrapLog,
        primeContracts: createBootstrapPrimeContracts(),
        builtinExtensions: createBuiltinExtensions(),
        setupTimeoutMs: getEnvironmentConfig().extensionSetupTimeoutMs,
      });
      wireTracingShim();
      assertRequiredContracts();
      return extensionLoader;
    };

    const fsType = config.fs?.type;
    const needsFSAdapter = fsType != null && fsType !== "local";

    if (!needsFSAdapter) {
      bootstrapLog.debug("Using local filesystem (no FSAdapter needed)");
      const loader = await setupExtensions();
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader: loader,
        dispose: combineDispose(loader, undefined, fileLog),
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
        projectDirectoryPresent: Boolean(projectDir),
        runtime: adapter.id,
        fsAdapter: "local",
      });

      const loader = await setupExtensions();
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader: loader,
        dispose: combineDispose(loader, undefined, fileLog),
      };
    }

    // Capture ownership immediately. Config reload and contract validation can
    // both fail after the adapter has opened connections or background work.
    fsDispose = getFileSystemDisposer(enhancedAdapter);

    const isProxyMode = config.fs?.veryfront?.proxyMode === true;
    const isProductionMode = config.fs?.veryfront?.productionMode === true;

    if (isProxyMode) {
      bootstrapLog.debug("Skipping config reload in proxy mode (using local config)");
    } else if (isProductionMode) {
      bootstrapLog.debug("Skipping config reload in production mode (using local config)");
    } else {
      const hasRemoteConfig = await hasVirtualConfigFile(enhancedAdapter.fs);
      if (hasRemoteConfig) {
        bootstrapLog.debug("Reloading config with FSAdapter");
        clearConfigCache();
        config = await getConfig(projectDir, enhancedAdapter);
        fileLog = await replaceFileLogSubscriber(fileLog, config);
      } else {
        bootstrapLog.debug("Keeping original config (FSAdapter has no config file)");
      }
    }

    bootstrapLog.debug("Framework initialized successfully", {
      projectDirectoryPresent: Boolean(projectDir),
      runtime: adapter.id,
      fsAdapter: fsType,
    });

    const loader = await setupExtensions();

    return {
      adapter: enhancedAdapter,
      config,
      usingFSAdapter: true,
      fsAdapterType: fsType,
      extensionLoader: loader,
      dispose: combineDispose(loader, fsDispose, fileLog),
    };
  } catch (err) {
    const cleanup = createBootstrapDisposer({
      teardownExtensions: () => extensionLoader?.teardownAll(),
      teardownFileLog: () => teardownFileLog(fileLog),
      clearTracing: () => __registerLogRecordEmitter(null),
      disposeFileSystem: fsDispose,
    });
    try {
      await cleanup();
    } catch (cleanupError) {
      bootstrapLog.warn("Bootstrap cleanup failed after initialization failed", {
        errorName: getSafeErrorName(cleanupError),
      });
    }
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
      projectConfigured: Boolean(result.config.fs?.veryfront?.projectSlug),
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
      errorName: getSafeErrorName(error),
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
    if (nodeEnv !== "production") {
      logger.error(
        "[Bootstrap:Prod] NODE_ENV must be set to production in proxy mode.",
      );
      throw INVALID_ARGUMENT.create({
        detail: "NODE_ENV must be set to 'production' when running in proxy mode (PROXY_MODE=1)",
      });
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
  }

  // Log effective configuration for debugging
  bootstrapProdLog.debug("Environment configuration", {
    nodeEnv: nodeEnv ?? "(unset)",
    proxyMode: proxyMode ?? "0",
  });
}
