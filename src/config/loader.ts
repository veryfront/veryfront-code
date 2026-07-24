import type { VeryfrontConfig } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import { extname, join, resolve, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey, type VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { DEFAULT_PORT } from "./defaults.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  CACHE_INVARIANT_VIOLATION,
  CONFIG_PARSE_ERROR,
  CONFIG_VALIDATION_FAILED,
} from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { VERYFRONT_CONFIG_SHIM_URL } from "./config-shim.ts";

const logger = serverLogger.component("config");

/** Cache TTL for veryfront-api filesystem in proxy mode */
const DEFAULT_FS_CACHE_TTL_MS = 60_000;
/** Maximum retry attempts for veryfront-api filesystem requests */
const DEFAULT_FS_MAX_RETRIES = 3;
/** Initial backoff delay between retries */
const DEFAULT_FS_INITIAL_DELAY_MS = 500;
/** Maximum backoff delay between retries */
const DEFAULT_FS_MAX_DELAY_MS = 5_000;
/** Maximum entries in the render cache */
const DEFAULT_RENDER_CACHE_MAX_ENTRIES = 500;
/** Maximum entries in the per-project config cache */
const DEFAULT_CONFIG_CACHE_MAX_ENTRIES = 100;

export type { VeryfrontConfig } from "./schemas/index.ts";

/**
 * Creates fresh default import map per-request.
 * Previously this was called once at module load, causing all projects to share
 * the same import map object which could be mutated.
 *
 * @see plans/architecture-audit/007.3-default-config-shared-reference.md
 */
function getDefaultImportMapForConfig(): { imports: ReturnType<typeof getReactImportMap> } {
  return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}

function requireProxyApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: "PROXY_MODE=1 requires VERYFRONT_API_BASE_URL",
    });
  }

  try {
    const url = new URL(normalized);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError("unsupported proxy API URL");
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    throw CONFIG_VALIDATION_FAILED.create({
      detail:
        "VERYFRONT_API_BASE_URL must be an HTTP(S) base URL without credentials, query, or fragment in proxy mode",
    });
  }
}

/**
 * Creates default fs config based on environment.
 * In proxy mode (PROXY_MODE=1), uses veryfront-api filesystem.
 * Otherwise uses local filesystem.
 */
function getDefaultFsConfig(): VeryfrontConfig["fs"] {
  const proxyModeEnv = getHostEnv("PROXY_MODE");
  const isProxyMode = proxyModeEnv === "1";
  const apiBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");

  logger.debug("getDefaultFsConfig called", {
    proxyModeEnv,
    isProxyMode,
    hasApiBaseUrl: Boolean(apiBaseUrl),
  });

  if (isProxyMode) {
    const trustedApiBaseUrl = requireProxyApiBaseUrl(apiBaseUrl);
    logger.info("Using veryfront-api filesystem (proxy mode)");
    return {
      type: "veryfront-api",
      veryfront: {
        apiBaseUrl: trustedApiBaseUrl,
        proxyMode: true,
        cache: { enabled: true, ttl: DEFAULT_FS_CACHE_TTL_MS },
        retry: {
          maxRetries: DEFAULT_FS_MAX_RETRIES,
          initialDelay: DEFAULT_FS_INITIAL_DELAY_MS,
          maxDelay: DEFAULT_FS_MAX_DELAY_MS,
        },
      },
    };
  }

  logger.info("Using local filesystem (no proxy mode)");
  return { type: "local" };
}

/**
 * Creates a fresh copy of default config for each merge operation.
 * This prevents shared mutable state between projects.
 *
 * Previously DEFAULT_CONFIG was a module-level object that could be mutated
 * through shallow spreads, causing cross-tenant contamination.
 *
 * @see plans/architecture-audit/007.3-default-config-shared-reference.md
 */
function createFreshDefaults(): Partial<VeryfrontConfig> {
  return {
    title: "Veryfront App",
    description: "Built with Veryfront",
    fs: getDefaultFsConfig(),
    experimental: {
      esmLayouts: true,
    },
    router: undefined,
    theme: {
      colors: {
        primary: "#3B82F6",
      },
    },
    build: {
      outDir: "dist",
      trailingSlash: false,
      esbuild: {
        wasmURL: "https://deno.land/x/esbuild@v0.20.1/esbuild.wasm",
        worker: false,
      },
    },
    cache: {
      dir: DEFAULT_CACHE_DIR,
      render: {
        type: "memory",
        ttl: undefined,
        maxEntries: DEFAULT_RENDER_CACHE_MAX_ENTRIES,
        kvPath: undefined,
        redisUrl: undefined,
        redisKeyPrefix: undefined,
      },
    },
    dev: {
      port: DEFAULT_PORT,
      host: "localhost",
      open: false,
      hmr: true,
    },
    resolve: {
      importMap: getDefaultImportMapForConfig(),
    },
    client: {
      moduleResolution: "cdn",
      cdn: {
        provider: "esm.sh",
        versions: "auto",
      },
    },
  };
}

const configCacheByProject = new LRUCache<string, { revision: number; config: VeryfrontConfig }>({
  maxEntries: DEFAULT_CONFIG_CACHE_MAX_ENTRIES,
});

// Register cache for monitoring
registerLRUCache("config-cache", configCacheByProject);

let cacheRevision = 0;

function validateConfigShape(userConfig: unknown): VeryfrontConfig {
  return validateVeryfrontConfig(userConfig) as VeryfrontConfig;
}

const FILESYSTEM_BACKEND_KEYS = ["local", "veryfront", "memory", "github"] as const;
type FilesystemBackendKey = (typeof FILESYSTEM_BACKEND_KEYS)[number];

function filesystemBackendKey(
  type: string,
): FilesystemBackendKey {
  switch (type) {
    case "local":
    case "memory":
    case "github":
      return type;
    case "veryfront-api":
      return "veryfront";
    default:
      throw CONFIG_VALIDATION_FAILED.create({
        detail: `Unsupported filesystem backend "${type}"`,
      });
  }
}

function mergeFilesystemConfig(
  defaults: VeryfrontConfig["fs"],
  userConfig: VeryfrontConfig["fs"],
): NonNullable<VeryfrontConfig["fs"]> {
  if (defaults?.type === "veryfront-api" && defaults.veryfront?.proxyMode === true) {
    if (userConfig && Object.keys(userConfig).length > 0) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail:
          "Filesystem configuration is platform-managed in proxy mode and cannot be overridden by project config",
      });
    }
    return {
      ...defaults,
      veryfront: {
        ...defaults.veryfront,
        ...(defaults.veryfront.cache ? { cache: { ...defaults.veryfront.cache } } : {}),
        ...(defaults.veryfront.retry ? { retry: { ...defaults.veryfront.retry } } : {}),
      },
    };
  }

  const selectedType = userConfig?.type ?? defaults?.type ?? "local";
  const selectedKey = filesystemBackendKey(selectedType);
  for (const key of FILESYSTEM_BACKEND_KEYS) {
    if (key !== selectedKey && userConfig?.[key] !== undefined) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: `Filesystem options for "${key}" do not match selected backend "${selectedType}"`,
      });
    }
  }

  const selectedDefaults = defaults?.type === selectedType ? defaults : undefined;
  const merged: NonNullable<VeryfrontConfig["fs"]> = {
    type: selectedType,
  };

  if (selectedKey === "local" && (selectedDefaults?.local || userConfig?.local)) {
    merged.local = { ...selectedDefaults?.local, ...userConfig?.local };
  } else if (selectedKey === "memory" && (selectedDefaults?.memory || userConfig?.memory)) {
    merged.memory = { ...selectedDefaults?.memory, ...userConfig?.memory };
  } else if (
    selectedKey === "veryfront" &&
    (selectedDefaults?.veryfront || userConfig?.veryfront)
  ) {
    const veryfront = {
      ...selectedDefaults?.veryfront,
      ...userConfig?.veryfront,
    } as NonNullable<NonNullable<VeryfrontConfig["fs"]>["veryfront"]>;
    if (selectedDefaults?.veryfront?.cache || userConfig?.veryfront?.cache) {
      veryfront.cache = {
        ...selectedDefaults?.veryfront?.cache,
        ...userConfig?.veryfront?.cache,
      };
    }
    if (selectedDefaults?.veryfront?.retry || userConfig?.veryfront?.retry) {
      veryfront.retry = {
        ...selectedDefaults?.veryfront?.retry,
        ...userConfig?.veryfront?.retry,
      };
    }
    merged.veryfront = veryfront;
  } else if (selectedKey === "github" && (selectedDefaults?.github || userConfig?.github)) {
    const github = {
      ...selectedDefaults?.github,
      ...userConfig?.github,
    } as NonNullable<NonNullable<VeryfrontConfig["fs"]>["github"]>;
    if (selectedDefaults?.github?.cache || userConfig?.github?.cache) {
      github.cache = {
        ...selectedDefaults?.github?.cache,
        ...userConfig?.github?.cache,
      };
    }
    if (selectedDefaults?.github?.retry || userConfig?.github?.retry) {
      github.retry = {
        ...selectedDefaults?.github?.retry,
        ...userConfig?.github?.retry,
      };
    }
    merged.github = github;
  }

  return merged;
}

/** @internal Exported for tests: merges user config over fresh defaults (deep for nested objects). */
export function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const defaults = createFreshDefaults();
  const mergedFs = mergeFilesystemConfig(defaults.fs, userConfig.fs);

  const merged = {
    ...defaults,
    ...userConfig,
    fs: mergedFs,
    dev: {
      ...defaults.dev,
      ...userConfig.dev,
    },
    theme: {
      ...defaults.theme,
      ...userConfig.theme,
      // Deep-merge colors so a user setting one color keeps the default palette.
      colors: {
        ...defaults.theme?.colors,
        ...userConfig.theme?.colors,
      },
    },
    build: {
      ...defaults.build,
      ...userConfig.build,
      // Deep-merge esbuild so a partial override keeps default wasmURL/worker.
      esbuild: {
        ...defaults.build?.esbuild,
        ...userConfig.build?.esbuild,
      },
    },
    cache: {
      ...defaults.cache,
      ...userConfig.cache,
      // Deep-merge render so `cache: { dir: "/custom" }` doesn't drop the default
      // render sub-object (whose absence crashed callers reading cache.render.type).
      render: {
        ...defaults.cache?.render,
        ...userConfig.cache?.render,
      },
    },
    resolve: {
      ...defaults.resolve,
      ...userConfig.resolve,
    },
    client: {
      ...defaults.client,
      ...userConfig.client,
      cdn: {
        ...defaults.client?.cdn,
        ...userConfig.client?.cdn,
      },
    },
  } as VeryfrontConfig;

  const defaultMap = defaults.resolve?.importMap;
  const userMap = userConfig.resolve?.importMap;

  if (merged.resolve && (defaultMap || userMap)) {
    merged.resolve.importMap = {
      imports: {
        ...(defaultMap?.imports ?? {}),
        ...(userMap?.imports ?? {}),
      },
      scopes: {
        ...(defaultMap?.scopes ?? {}),
        ...(userMap?.scopes ?? {}),
      },
    };
  }

  return merged;
}

function validateAndMergeConfig(userConfig: unknown): VeryfrontConfig {
  if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
    });
  }

  const normalizedConfig = validateConfigShape(userConfig);

  const merged = mergeConfigs(normalizedConfig);

  if (merged.react?.version) {
    logger.debug("React version from config", { version: merged.react.version });
  }

  return merged;
}

function isConfigError(error: unknown): boolean {
  return error instanceof VeryfrontError &&
    (error.slug === "config-validation-failed" || error.slug === "config-parse-error");
}

async function loadConfigFromTempFile(
  source: string,
  configPath: string,
  loadUrl: (tempFile: string) => string,
): Promise<unknown> {
  const fs = createFileSystem();
  const originalExt = extname(configPath) || ".mjs";

  // In compiled Deno binaries, we can't import TypeScript directly.
  // Convert .ts/.tsx to .mjs after running it through the bundler transform.
  const needsTranspile = isDenoCompiled && (originalExt === ".ts" || originalExt === ".tsx");
  const extension = needsTranspile ? ".mjs" : originalExt;
  const processedSource = needsTranspile
    ? await transpileConfigSourceForImport(source, configPath)
    : source;

  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, `config${extension}`);

  try {
    await fs.writeTextFile(
      tempFile,
      await rewriteBareVeryfrontConfigImports(processedSource),
    );
    const configModule = await import(loadUrl(tempFile));
    return configModule.default || configModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

/**
 * Inline stand-in for the bare `veryfront` specifier in user config files.
 *
 * Config modules loaded through {@link loadConfigFromTempFile} execute from a
 * temp file, where bare specifiers have no resolver: Node has no node_modules
 * relative to the temp dir, and compiled Deno binaries have no import map for
 * external dynamic imports. The data URL delegates to the same helper
 * implementations as the framework entrypoint, including its scoped
 * environment reader.
 */
type DefaultModuleLexerModule = {
  EsModuleLexer: new () => ModuleLexer;
};

let fallbackModuleLexerPromise: Promise<ModuleLexer> | undefined;

async function getConfigModuleLexer(): Promise<ModuleLexer> {
  const registered = tryResolveContract<ModuleLexer>("ModuleLexer");
  if (registered) return registered;

  fallbackModuleLexerPromise ??= importFirstPartyExtensionModule<DefaultModuleLexerModule>(
    "ext-bundler-esbuild",
    "@veryfront/ext-bundler-esbuild",
  ).then(({ EsModuleLexer }) => new EsModuleLexer());
  return await fallbackModuleLexerPromise;
}

/**
 * Rewrite bare `veryfront` import specifiers to the inline config shim so
 * temp-file config modules can load. Static imports only (`import ... from
 * "veryfront"` and side-effect `import "veryfront"`); subpaths like
 * `veryfront/head` are left untouched and will fail loudly, which is correct —
 * they have no meaning in a config file.
 *
 * @internal exported for tests
 */
export async function rewriteBareVeryfrontConfigImports(source: string): Promise<string> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();

  const imports = lexer.parse(source);
  let rewritten = source;
  for (let index = imports.length - 1; index >= 0; index--) {
    const specifier = imports[index];
    if (!specifier || specifier.d !== -1 || specifier.n !== "veryfront") continue;
    rewritten = rewritten.slice(0, specifier.s) +
      VERYFRONT_CONFIG_SHIM_URL +
      rewritten.slice(specifier.e);
  }
  return rewritten;
}

/** @internal */
export async function transpileConfigSourceForImport(
  source: string,
  configPath: string,
): Promise<string> {
  const { transform } = await import("veryfront/extensions/bundler");
  const extension = extname(configPath);
  const loader = extension === ".tsx" ? "tsx" : "ts";
  const result = await transform(source, {
    format: "esm",
    loader,
    sourcemap: false,
  });
  return result.code;
}

/**
 * Load config from virtual filesystem.
 * Uses esbuild to transpile TypeScript to JavaScript before importing.
 */
function loadConfigFromVirtualFS(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  return withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      logger.debug("Loading config from virtual filesystem (API)", { configPath });
      const content = await adapter.fs.readFile(configPath);
      const source = typeof content === "string" ? content : new TextDecoder().decode(content);
      logger.debug("Got config source from API", {
        configPath,
        sourceLength: source.length,
      });

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => {
          const url = toFileUrl(tempFile);
          url.searchParams.set("v", String(Date.now()));
          return url.href;
        },
      );

      logger.debug("Loaded config from virtual filesystem", {
        configPath,
        hasApp: !!(userConfig as Record<string, unknown>)?.app,
        hasLayout: !!(userConfig as Record<string, unknown>)?.layout,
        hasRouter: !!(userConfig as Record<string, unknown>)?.router,
        configKeys: Object.keys(userConfig as Record<string, unknown>),
      });

      return validateAndMergeConfig(userConfig);
    },
    { "config.path": configPath, "config.project_dir": cacheKey, "config.source": "virtual_fs" },
  );
}

async function loadAndMergeConfig(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  const isVirtualFS = isVirtualFilesystem(adapter.fs);
  logger.debug("loadAndMergeConfig called", {
    configPath,
    cacheKey,
    isVirtualFS,
    isBun,
    isDenoCompiled,
  });

  if (isVirtualFS) {
    logger.debug("Using virtual filesystem (API) for config", { configPath });
    return loadConfigFromVirtualFS(configPath, cacheKey, adapter);
  }

  // Bun and compiled Deno binaries can't dynamically import TypeScript files directly.
  // We need to read the source, write to a temp file, and import from there.
  if (isBun || isDenoCompiled) {
    logger.debug("Using temp file import for Bun/compiled Deno", {
      configPath,
      isBun,
      isDenoCompiled,
    });
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      configPath,
      (tempFile) => toFileUrl(tempFile).href,
    );
    logger.debug("Successfully loaded config via temp file", {
      configPath,
      hasApp: !!(userConfig as Record<string, unknown>)?.app,
      hasRouter: !!(userConfig as Record<string, unknown>)?.router,
    });
    return validateAndMergeConfig(userConfig);
  }

  const absolutePath = resolve(configPath);
  const configUrl = toFileUrl(absolutePath);
  configUrl.searchParams.set("t", `${Date.now()}-${crypto.randomUUID()}`);
  const configModule = await import(configUrl.href);
  return validateAndMergeConfig(configModule.default || configModule);
}

/**
 * Options for getConfig
 */
export interface GetConfigOptions {
  /**
   * Cache key for virtual filesystem (API-backed) projects.
   * When provided, this is used instead of projectDir for caching.
   * This should be a unique project identifier (e.g., projectId or projectSlug).
   */
  cacheKey?: string;

  /**
   * Exact source selected by the trusted caller for a virtual filesystem read.
   * The source must match the active request context. Mutable branch sources
   * are never stored in the process-wide config cache.
   */
  sourceContext?: VirtualConfigSourceContext;
}

function getVirtualConfigSourceContext(): VirtualConfigSourceContext | undefined {
  const source = getCurrentRequestContext();
  if (!source) return undefined;

  return {
    productionMode: source.productionMode,
    releaseId: source.releaseId,
    branch: source.branch,
    environmentName: source.environmentName,
  };
}

function describeVirtualConfigSource(context: VirtualConfigSourceContext): string {
  if (!context.productionMode) return `branch:${context.branch ?? "main"}`;
  if (context.environmentName) {
    return `environment:${context.environmentName}:${context.releaseId ?? "missing-release"}`;
  }
  return `release:${context.releaseId ?? "missing-release"}`;
}

type NormalizedVirtualConfigSource =
  | { productionMode: false; branch: string }
  | {
    productionMode: true;
    releaseId: string | null;
    environmentName: string | null;
  };

function normalizeVirtualConfigSource(
  context: VirtualConfigSourceContext,
): NormalizedVirtualConfigSource {
  if (!context.productionMode) {
    return { productionMode: false, branch: context.branch ?? "main" };
  }

  return {
    productionMode: true,
    releaseId: context.releaseId ?? null,
    environmentName: context.environmentName ?? null,
  };
}

function virtualConfigSourcesMatch(
  expected: NormalizedVirtualConfigSource,
  actual: NormalizedVirtualConfigSource,
): boolean {
  if (expected.productionMode !== actual.productionMode) return false;
  if (!expected.productionMode && !actual.productionMode) {
    return expected.branch === actual.branch;
  }
  if (expected.productionMode && actual.productionMode) {
    return expected.releaseId === actual.releaseId &&
      expected.environmentName === actual.environmentName;
  }
  return false;
}

function assertMatchingVirtualConfigSource(
  expected: VirtualConfigSourceContext,
  actual: VirtualConfigSourceContext | undefined,
): void {
  if (!actual) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Explicit virtual config source requires an active request context",
    });
  }

  const expectedSource = normalizeVirtualConfigSource(expected);
  const actualSource = normalizeVirtualConfigSource(actual);
  if (virtualConfigSourcesMatch(expectedSource, actualSource)) return;

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: `Explicit virtual config source "${
      describeVirtualConfigSource(expected)
    }" does not match the current request context "${describeVirtualConfigSource(actual)}"`,
  });
}

export function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<VeryfrontConfig> {
  const getConfigStartTime = performance.now();
  const cacheKeyForLog = options?.cacheKey || "unknown";

  logger.debug("getConfig START", { projectDir, cacheKey: cacheKeyForLog });

  return withSpan(
    SpanNames.CONFIG_LOAD,
    async () => {
      const revisionAtStart = cacheRevision;
      const isVirtualFS = isVirtualFilesystem(adapter.fs);
      if (options?.sourceContext && (!isVirtualFS || !options.cacheKey)) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: "Explicit config source requires a virtual filesystem and cacheKey",
        });
      }

      const ambientSourceContext = isVirtualFS ? getVirtualConfigSourceContext() : undefined;
      if (options?.sourceContext) {
        assertMatchingVirtualConfigSource(options.sourceContext, ambientSourceContext);
      }
      const sourceContext = isVirtualFS && options?.cacheKey
        ? options.sourceContext ?? ambientSourceContext
        : undefined;
      const usePersistentCache = !isVirtualFS || sourceContext?.productionMode === true;
      const effectiveCacheKey = buildConfigCacheKey(
        isVirtualFS && options?.cacheKey ? options.cacheKey : projectDir,
        isVirtualFS && !!options?.cacheKey,
        sourceContext,
      );

      logger.debug("Cache key built", {
        effectiveCacheKey,
        isVirtualFS,
        cacheKey: cacheKeyForLog,
        source: sourceContext ? describeVirtualConfigSource(sourceContext) : undefined,
        usePersistentCache,
      });

      const cached = usePersistentCache ? configCacheByProject.get(effectiveCacheKey) : undefined;
      if (cached?.revision === revisionAtStart) {
        logger.debug("Cache HIT - using cached config", {
          cacheKey: effectiveCacheKey,
          isVirtualFS,
          hasApp: !!cached.config.app,
          hasLayout: !!(cached.config as Record<string, unknown>).layout,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        return cached.config;
      }

      logger.debug("Cache MISS - loading config", {
        cacheKey: effectiveCacheKey,
        isVirtualFS,
      });

      // For virtual filesystem, config is at project root ("/"), not the local projectDir
      const configBaseDir = isVirtualFS ? "/" : projectDir;

      for (const configFile of VERYFRONT_CONFIG_FILES) {
        const configPath = join(configBaseDir, configFile);
        const exists = await adapter.fs.exists(configPath);
        logger.debug("Checking config file", { configPath, exists, isVirtualFS });
        if (!exists) continue;

        try {
          const merged = await loadAndMergeConfig(configPath, effectiveCacheKey, adapter);
          if (usePersistentCache && cacheRevision === revisionAtStart) {
            configCacheByProject.set(effectiveCacheKey, {
              revision: revisionAtStart,
              config: merged,
            });
          }
          logger.debug("Successfully loaded config", {
            configFile,
            hasApp: !!merged.app,
            hasLayout: !!(merged as Record<string, unknown>).layout,
            configKeys: Object.keys(merged),
          });
          return merged;
        } catch (error) {
          if (isConfigError(error)) throw error;
          logger.warn("Failed to load config file", { configFile });
          throw CONFIG_PARSE_ERROR.create({
            detail: `Failed to load ${configFile}`,
            cause: error,
            context: { configFile },
          });
        }
      }

      logger.debug("No config file found, using defaults", {
        effectiveCacheKey,
        projectDir,
        isVirtualFS,
        duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
      });

      const defaultConfig = createFreshDefaults() as VeryfrontConfig;
      if (usePersistentCache && cacheRevision === revisionAtStart) {
        configCacheByProject.set(effectiveCacheKey, {
          revision: revisionAtStart,
          config: defaultConfig,
        });
      }
      return defaultConfig;
    },
    { "config.project_dir": projectDir, "config.cache_key": options?.cacheKey || "default" },
  );
}

export function clearConfigCache(): void {
  configCacheByProject.clear();
  cacheRevision++;
}

/**
 * Synchronous config cache lookup for hot paths.
 *
 * Returns cached config immediately without async overhead.
 * Use this for performance-critical paths when config is likely cached.
 *
 * @returns Cached config if valid, null if not cached or stale
 */
export function getCachedConfigSync(projectDir: string): VeryfrontConfig | null {
  const cached = configCacheByProject.get(buildConfigCacheKey(projectDir, false));
  if (!cached || cached.revision !== cacheRevision) return null;
  return cached.config;
}
