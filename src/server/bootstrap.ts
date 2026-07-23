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
  type GlobalTelemetryAPIInstallation,
  installGlobalTelemetryAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getErrorMessage, INVALID_ARGUMENT } from "#veryfront/errors";
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
import { ExclusiveProcessOwner } from "./process-ownership.ts";

const bootstrapLog = logger.component("bootstrap");
const bootstrapDevLog = logger.component("bootstrap-dev");
const bootstrapProdLog = logger.component("bootstrap-prod");
const bootstrapOwnership = new ExclusiveProcessOwner("Veryfront bootstrap");

type ResourceDisposer = () => void | Promise<void>;

/**
 * A bootstrap operation failed and at least one owned resource could not be
 * released. The process-wide bootstrap slot remains held. Call
 * `retryCleanup()` until it succeeds before attempting another bootstrap.
 */
export class BootstrapCleanupError extends AggregateError {
  constructor(
    primaryError: unknown,
    cleanupError: unknown,
    readonly retryCleanup: () => Promise<void>,
  ) {
    super(
      [primaryError, cleanupError],
      `Bootstrap failed and cleanup is incomplete: ${getErrorMessage(primaryError)}`,
    );
    this.name = "BootstrapCleanupError";
  }
}

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
   * Dispose all bootstrap-owned resources. The caller exclusively owns this
   * result and must eventually dispose it. Passing it as
   * `startProductionServer({ bootstrapResult })` transfers that ownership to
   * the returned server handle; do not dispose it separately.
   *
   * Cleanup tears down extensions in reverse order, clears telemetry and file
   * logging, releases FSAdapter resources, and frees the process-wide
   * bootstrap slot. Concurrent calls share an in-flight attempt. A successful
   * cleanup is idempotent; a failed cleanup retains ownership and a later call
   * retries only the unfinished phases.
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

/** Generation-owned installation of bootstrap telemetry globals. */
export interface TracingShimInstallation {
  /** Clear this installation if it is still current. */
  dispose(): boolean;
}

let activeTracingShimInstallation: TracingShimInstallation | undefined;
let activeLogEmitterOwner: symbol | undefined;

export function wireTracingShim(): TracingShimInstallation {
  const tracing = tryResolve<TracingExporter>("TracingExporter");
  let telemetryInstallation: GlobalTelemetryAPIInstallation;
  let logRecordEmitter: ReturnType<NonNullable<TracingExporter["getLogRecordEmitter"]>> = null;

  if (tracing) {
    // Read every exporter getter before installing anything. A getter failure
    // therefore leaves the previous telemetry generation wholly intact.
    const tracerProvider = tracing.getProvider();
    const metricsApi = tracing.getMetricsAPI();
    const activeSpanAccessor = tracing.getTraceAPI?.() ?? null;
    const contextAccessor = tracing.getContextAPI?.() ?? null;
    const logRecordEmitterCandidate: unknown = tracing.getLogRecordEmitter?.() ?? null;

    if (
      tracerProvider === null || typeof tracerProvider !== "object" ||
      typeof tracerProvider.getTracer !== "function"
    ) {
      throw new TypeError("TracingExporter.getProvider() must return a tracer provider");
    }
    if (logRecordEmitterCandidate !== null && typeof logRecordEmitterCandidate !== "function") {
      throw new TypeError(
        "TracingExporter.getLogRecordEmitter() must return a function or null",
      );
    }
    logRecordEmitter = logRecordEmitterCandidate as typeof logRecordEmitter;

    type TelemetryConfig = Parameters<typeof installGlobalTelemetryAPI>[0];
    telemetryInstallation = installGlobalTelemetryAPI({
      tracerProvider: tracerProvider as TelemetryConfig["tracerProvider"],
      metricsApi: metricsApi as TelemetryConfig["metricsApi"],
      activeSpanAccessor: activeSpanAccessor as TelemetryConfig["activeSpanAccessor"],
      contextAccessor: contextAccessor as TelemetryConfig["contextAccessor"],
    });
    bootstrapLog.debug("[bootstrap] TracingExporter wired into shim");
  } else {
    telemetryInstallation = installGlobalTelemetryAPI({});
    bootstrapLog.debug("[bootstrap] no TracingExporter extension — using no-op tracer");
  }

  const logEmitterOwner = Symbol("veryfront.bootstrap.log-emitter");
  __registerLogRecordEmitter(logRecordEmitter);
  activeLogEmitterOwner = logEmitterOwner;

  const installation: TracingShimInstallation = Object.freeze({
    dispose: (): boolean => {
      const telemetryCleared = telemetryInstallation.dispose();
      let emitterCleared = false;
      if (activeLogEmitterOwner === logEmitterOwner) {
        activeLogEmitterOwner = undefined;
        __registerLogRecordEmitter(null);
        emitterCleared = true;
      }
      if (activeTracingShimInstallation === installation) {
        activeTracingShimInstallation = undefined;
      }
      return telemetryCleared || emitterCleared;
    },
  });
  activeTracingShimInstallation = installation;
  return installation;
}

function clearActiveTracingShimForExtensionTransition(): void {
  activeTracingShimInstallation?.dispose();
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
  unsubscribed?: boolean;
  closed?: boolean;
  disposePromise?: Promise<void>;
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

async function teardownFileLog(handle: FileLogHandle | null): Promise<void> {
  if (!handle) return;
  if (handle.unsubscribed && handle.closed) return;
  if (handle.disposePromise) return await handle.disposePromise;

  const attempt = (async () => {
    const failures: unknown[] = [];
    if (!handle.unsubscribed) {
      try {
        handle.unsubscribe();
        handle.unsubscribed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (!handle.closed) {
      try {
        await handle.subscriber.close();
        handle.closed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "File log cleanup failed");
    }
  })();
  handle.disposePromise = attempt;
  try {
    await attempt;
  } finally {
    if (handle.disposePromise === attempt && !(handle.unsubscribed && handle.closed)) {
      handle.disposePromise = undefined;
    }
  }
}

/**
 * Prepare a replacement before retiring the current resource. If retirement
 * fails, dispose the prepared candidate so ownership never leaks.
 *
 * @internal Exported for lifecycle regression tests.
 */
export async function replaceLifecycleResource<T>(
  current: T | null,
  createReplacement: () => T | null,
  dispose: (resource: T) => void | Promise<void>,
): Promise<T | null> {
  const replacement = createReplacement();
  if (current === null) return replacement;

  try {
    await dispose(current);
  } catch (retirementError) {
    if (replacement !== null && replacement !== current) {
      try {
        await dispose(replacement);
      } catch (rollbackError) {
        throw new AggregateError(
          [retirementError, rollbackError],
          "Lifecycle resource replacement and rollback failed",
        );
      }
    }
    throw retirementError;
  }
  return replacement;
}

function combineDispose(
  extensionLoader: ExtensionLoader,
  fsDispose?: ResourceDisposer,
  fileLogHandle?: FileLogHandle | null,
  tracingShimInstallation?: TracingShimInstallation,
  releaseBootstrapOwnership?: () => void,
): () => Promise<void> {
  let extensionsDisposed = false;
  let tracingDisposed = false;
  let fileLogDisposed = false;
  let fsDisposed = false;
  let ownershipReleased = false;

  return createRetryableDisposer(async () => {
    if (!extensionsDisposed) {
      await extensionLoader.teardownAll();
      extensionsDisposed = true;
    }
    if (!tracingDisposed) {
      tracingShimInstallation?.dispose();
      tracingDisposed = true;
    }
    if (!fileLogDisposed) {
      await teardownFileLog(fileLogHandle ?? null);
      fileLogDisposed = true;
    }
    if (!fsDisposed) {
      await fsDispose?.();
      fsDisposed = true;
    }
    if (!ownershipReleased) {
      releaseBootstrapOwnership?.();
      ownershipReleased = true;
    }
  });
}

/**
 * Serialize cleanup attempts, retaining successful completion while allowing
 * an explicit retry after a failed attempt.
 *
 * Use this for resources whose ownership must remain held until cleanup is
 * confirmed. The cleanup callback must be idempotent across failed attempts.
 *
 * @internal
 */
export function createRetryableDisposer(
  dispose: () => void | Promise<void>,
): () => Promise<void> {
  let disposePromise: Promise<void> | undefined;
  return () => {
    if (disposePromise) return disposePromise;
    const attempt = Promise.resolve().then(dispose);
    disposePromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        if (disposePromise === attempt) disposePromise = undefined;
      },
    );
    return attempt;
  };
}

async function finalizeExtensionBootstrap(
  extensionLoader: ExtensionLoader,
  fsDispose: ResourceDisposer | undefined,
  fileLogHandle: FileLogHandle | null,
  releaseBootstrapOwnership: () => void,
): Promise<() => Promise<void>> {
  let tracingShimInstallation: TracingShimInstallation | undefined;
  try {
    tracingShimInstallation = wireTracingShim();
    assertRequiredContracts();
    return combineDispose(
      extensionLoader,
      fsDispose,
      fileLogHandle,
      tracingShimInstallation,
      releaseBootstrapOwnership,
    );
  } catch (error) {
    const retryCleanup = combineDispose(
      extensionLoader,
      fsDispose,
      fileLogHandle,
      tracingShimInstallation,
      releaseBootstrapOwnership,
    );
    try {
      await retryCleanup();
    } catch (cleanupError) {
      throw new BootstrapCleanupError(error, cleanupError, retryCleanup);
    }
    throw error;
  }
}

/** @internal Exported for lifecycle regression tests. */
export function createStartupFailureCleanup(
  cleanupSteps: readonly ResourceDisposer[],
  releaseBootstrapOwnership: () => void,
): () => Promise<void> {
  const completedSteps = new Set<number>();
  let ownershipReleased = false;

  return createRetryableDisposer(async () => {
    const failures: unknown[] = [];
    for (let index = 0; index < cleanupSteps.length; index++) {
      if (completedSteps.has(index)) continue;
      try {
        await cleanupSteps[index]!();
        completedSteps.add(index);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw failures.length === 1
        ? failures[0]
        : new AggregateError(failures, "Bootstrap resource cleanup failed");
    }
    if (!ownershipReleased) {
      releaseBootstrapOwnership();
      ownershipReleased = true;
    }
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
  fsDispose: ResourceDisposer | undefined,
): Promise<ExtensionLoader> {
  try {
    return await orchestrate();
  } catch (err) {
    try {
      await fsDispose?.();
    } catch (disposeError) {
      bootstrapLog.warn("FS adapter cleanup failed after extension orchestration error", {
        error: disposeError,
      });
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
  const releaseBootstrapOwnership = bootstrapOwnership.acquire();
  bootstrapLog.debug("Starting framework initialization", {
    projectDir,
    runtime: adapter.id,
  });

  let fileLog: FileLogHandle | null = null;
  let fsDispose: ResourceDisposer | undefined;

  try {
    // Initialize esbuild early - extracts binary from VFS if running as deno compile
    // This must happen before any module imports esbuild
    await initializeEsbuild();
    await ensureEnvLoaded(projectDir, adapter);
    ensureBuiltinSchemaValidator();

    bootstrapLog.debug("Loading config with base adapter");
    let config = await getConfig(projectDir, adapter);

    fileLog = maybeAttachFileLogSubscriber(config);

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
        beforeActivate: clearActiveTracingShimForExtensionTransition,
      });
      const ownedFileLog = fileLog;
      const dispose = await finalizeExtensionBootstrap(
        extensionLoader,
        undefined,
        ownedFileLog,
        releaseBootstrapOwnership,
      );
      fileLog = null;
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader,
        dispose,
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

    // Capture ownership immediately after allocation. Config reload and file
    // logging can still fail below, and those failures must not leak sockets,
    // caches, or other adapter resources.
    if (isExtendedFSAdapter(enhancedAdapter.fs)) {
      const underlying = enhancedAdapter.fs.getUnderlyingAdapter();
      if (
        "dispose" in underlying &&
        typeof (underlying as { dispose?: ResourceDisposer }).dispose === "function"
      ) {
        const disposeUnderlying = (underlying as { dispose: ResourceDisposer }).dispose.bind(
          underlying,
        );
        fsDispose = createRetryableDisposer(disposeUnderlying);
      }
    }

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
        beforeActivate: clearActiveTracingShimForExtensionTransition,
      });
      const ownedFileLog = fileLog;
      const dispose = await finalizeExtensionBootstrap(
        extensionLoader,
        fsDispose,
        ownedFileLog,
        releaseBootstrapOwnership,
      );
      fileLog = null;
      return {
        adapter,
        config,
        usingFSAdapter: false,
        extensionLoader,
        dispose,
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

      // Prepare the new sink first. A disabled reloaded config intentionally
      // transitions to null; a failed replacement is rolled back and cannot
      // leak a second subscriber.
      fileLog = await replaceLifecycleResource(
        fileLog,
        () => maybeAttachFileLogSubscriber(config),
        teardownFileLog,
      );
    }

    bootstrapLog.debug("Framework initialized successfully", {
      projectDir,
      runtime: adapter.id,
      fsAdapter: fsType,
    });

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
          beforeActivate: clearActiveTracingShimForExtensionTransition,
        }),
      fsDispose,
    );
    const ownedFileLog = fileLog;
    const dispose = await finalizeExtensionBootstrap(
      extensionLoader,
      fsDispose,
      ownedFileLog,
      releaseBootstrapOwnership,
    );
    fileLog = null;

    return {
      adapter: enhancedAdapter,
      config,
      usingFSAdapter: true,
      fsAdapterType: fsType,
      extensionLoader,
      dispose,
    };
  } catch (err) {
    // finalizeExtensionBootstrap already owns every remaining resource and
    // exposes the only safe retry path. Running a second cleanup coordinator
    // here would release the process slot independently of that ownership.
    if (err instanceof BootstrapCleanupError) throw err;

    const retryCleanup = createStartupFailureCleanup(
      [
        () => teardownFileLog(fileLog),
        ...(fsDispose ? [fsDispose] : []),
      ],
      releaseBootstrapOwnership,
    );
    try {
      await retryCleanup();
    } catch (cleanupError) {
      throw new BootstrapCleanupError(err, cleanupError, retryCleanup);
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
