import type { VeryfrontConfig } from "./schemas/index.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schemas/index.ts";
import { extname, join, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey } from "#veryfront/cache/keys.ts";
import { DEFAULT_PORT } from "./defaults.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { CONFIG_PARSE_ERROR, CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";

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

/**
 * Creates default fs config based on environment.
 * In proxy mode (PROXY_MODE=1), uses veryfront-api filesystem.
 * Otherwise uses local filesystem.
 */
function getDefaultFsConfig(): VeryfrontConfig["fs"] {
  const proxyModeEnv = getEnv("PROXY_MODE");
  const isProxyMode = proxyModeEnv === "1";
  const apiBaseUrl = getEnv("VERYFRONT_API_BASE_URL");

  logger.debug("getDefaultFsConfig called", {
    proxyModeEnv,
    isProxyMode,
    apiBaseUrl: apiBaseUrl ? apiBaseUrl.slice(0, 30) : "(not set)",
  });

  if (isProxyMode && apiBaseUrl) {
    logger.info("Using veryfront-api filesystem (proxy mode)");
    return {
      type: "veryfront-api",
      veryfront: {
        apiBaseUrl,
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

function validateCorsConfig(userConfig: unknown): void {
  if (!userConfig || typeof userConfig !== "object") return;

  const cfg = userConfig as Record<string, unknown>;
  const security = cfg.security as Record<string, unknown> | undefined;
  if (!security) return;

  const cors = security.cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) return;

  const origin = (cors as Record<string, unknown>).origin;
  if (origin === undefined || typeof origin === "string") return;

  throw CONFIG_VALIDATION_FAILED.create({
    detail: "security.cors.origin must be a string. Expected boolean or { origin?: string }",
  });
}

function validateConfigShape(userConfig: unknown): VeryfrontConfig {
  const validatedConfig = validateVeryfrontConfig(userConfig) as VeryfrontConfig;
  if (!userConfig || typeof userConfig !== "object") return validatedConfig;

  const unknown = findUnknownTopLevelKeys(userConfig as Record<string, unknown>);
  if (unknown.length > 0) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: `Unknown config keys: ${unknown.join(", ")}. Check for typos in veryfront.config.`,
    });
  }
  return userConfig as VeryfrontConfig;
}

/** @internal Exported for tests: merges user config over fresh defaults (deep for nested objects). */
export function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const defaults = createFreshDefaults();

  const merged = {
    ...defaults,
    ...userConfig,
    fs: {
      ...defaults.fs,
      ...userConfig.fs,
      veryfront: {
        ...defaults.fs?.veryfront,
        ...userConfig.fs?.veryfront,
        // Nested sub-objects would otherwise be replaced wholesale by a partial
        // user override, dropping the default cache/retry fields.
        cache: {
          ...defaults.fs?.veryfront?.cache,
          ...userConfig.fs?.veryfront?.cache,
        },
        retry: {
          ...defaults.fs?.veryfront?.retry,
          ...userConfig.fs?.veryfront?.retry,
        },
      },
    },
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

function validateAndCacheConfig(userConfig: unknown, cacheKey: string): VeryfrontConfig {
  if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
    });
  }

  validateCorsConfig(userConfig);
  const normalizedConfig = validateConfigShape(userConfig);

  const merged = mergeConfigs(normalizedConfig);

  if (merged.react?.version) {
    logger.debug("React version from config", { version: merged.react.version });
  }

  configCacheByProject.set(cacheKey, { revision: cacheRevision, config: merged });
  return merged;
}

function isConfigError(error: unknown): boolean {
  // Prefer the structured slug check. The message-prefix check is only a fallback
  // for errors thrown before they were migrated to the VeryfrontError registry;
  // it is intentionally narrow to avoid misclassifying third-party errors.
  if (
    error instanceof VeryfrontError &&
    (error.slug === "config-validation-failed" || error.slug === "config-parse-error")
  ) return true;
  return error instanceof Error && error.message.startsWith("Invalid veryfront.config");
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
    await fs.writeTextFile(tempFile, rewriteBareVeryfrontConfigImports(processedSource));
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
 * external dynamic imports. Every config helper the framework entrypoint
 * exposes is a thin pure function, so a data: URL module is a faithful
 * stand-in. Written with double quotes only — encodeURIComponent escapes
 * them, keeping the URL safe inside either quote style of the rewritten
 * import statement.
 */
const VERYFRONT_CONFIG_SHIM = [
  "export const defineConfig = (config) => config;",
  "export const defineConfigWithEnv = (factory, envConfig) =>",
  '  factory(envConfig?.nodeEnv ?? globalThis.Deno?.env?.get?.("NODE_ENV") ??',
  '    globalThis.process?.env?.NODE_ENV ?? "production");',
  "export const mergeConfigs = (...configs) => Object.assign({}, ...configs);",
].join("\n");

const VERYFRONT_CONFIG_SHIM_URL = `data:text/javascript,${
  encodeURIComponent(VERYFRONT_CONFIG_SHIM)
}`;

/**
 * Rewrite bare `veryfront` import specifiers to the inline config shim so
 * temp-file config modules can load. Static imports only (`import ... from
 * "veryfront"` and side-effect `import "veryfront"`); subpaths like
 * `veryfront/head` are left untouched and will fail loudly, which is correct —
 * they have no meaning in a config file.
 *
 * @internal exported for tests
 */
export function rewriteBareVeryfrontConfigImports(source: string): string {
  return source.replace(
    /(\bfrom\s*|\bimport\s+)(["'])veryfront\2/g,
    (_match, prefix: string, quote: string) =>
      `${prefix}${quote}${VERYFRONT_CONFIG_SHIM_URL}${quote}`,
  );
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
        sourcePreview: source.slice(0, 200),
      });

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => `file://${tempFile}?v=${Date.now()}`,
      );

      logger.debug("Loaded config from virtual filesystem", {
        configPath,
        hasApp: !!(userConfig as Record<string, unknown>)?.app,
        hasLayout: !!(userConfig as Record<string, unknown>)?.layout,
        hasRouter: !!(userConfig as Record<string, unknown>)?.router,
        configKeys: Object.keys(userConfig as Record<string, unknown>),
      });

      return validateAndCacheConfig(userConfig, cacheKey);
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
      (tempFile) => `file://${tempFile}`,
    );
    logger.debug("Successfully loaded config via temp file", {
      configPath,
      hasApp: !!(userConfig as Record<string, unknown>)?.app,
      hasRouter: !!(userConfig as Record<string, unknown>)?.router,
    });
    return validateAndCacheConfig(userConfig, cacheKey);
  }

  const absolutePath = resolve(configPath);
  const configUrl = `file://${absolutePath}?t=${Date.now()}-${crypto.randomUUID()}`;
  const configModule = await import(configUrl);
  return validateAndCacheConfig(configModule.default || configModule, cacheKey);
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
      const isVirtualFS = isVirtualFilesystem(adapter.fs);
      const effectiveCacheKey = buildConfigCacheKey(
        isVirtualFS && options?.cacheKey ? options.cacheKey : projectDir,
        isVirtualFS && !!options?.cacheKey,
      );

      logger.debug("Cache key built", {
        effectiveCacheKey,
        isVirtualFS,
        cacheKey: cacheKeyForLog,
      });

      const cached = configCacheByProject.get(effectiveCacheKey);
      if (cached?.revision === cacheRevision) {
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
      configCacheByProject.set(effectiveCacheKey, {
        revision: cacheRevision,
        config: defaultConfig,
      });
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
