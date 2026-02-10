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
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";

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

  serverLogger.info("[CONFIG] getDefaultFsConfig called", {
    proxyModeEnv,
    isProxyMode,
    apiBaseUrl: apiBaseUrl ? apiBaseUrl.slice(0, 30) : "(not set)",
  });

  if (isProxyMode && apiBaseUrl) {
    serverLogger.info("[CONFIG] Using veryfront-api filesystem (proxy mode)");
    return {
      type: "veryfront-api",
      veryfront: {
        apiBaseUrl,
        proxyMode: true,
        cache: { enabled: true, ttl: 60000 },
        retry: { maxRetries: 3, initialDelay: 500, maxDelay: 5000 },
      },
    };
  }

  serverLogger.info("[CONFIG] Using local filesystem (no proxy mode)");
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
        maxEntries: 500,
        kvPath: undefined,
        redisUrl: undefined,
        redisKeyPrefix: undefined,
      },
    },
    dev: {
      port: DEFAULT_PORT,
      host: "localhost",
      open: false,
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
  maxEntries: 100,
});

// Register cache for monitoring
registerLRUCache("config-cache", configCacheByProject);

let cacheRevision = 0;

function validateCorsConfig(userConfig: unknown): void {
  if (!userConfig || typeof userConfig !== "object") return;

  const security = (userConfig as Record<string, unknown>).security as
    | Record<string, unknown>
    | undefined;
  const cors = security?.cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) return;

  const origin = (cors as Record<string, unknown>).origin;
  if (origin !== undefined && typeof origin !== "string") {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: "security.cors.origin must be a string. Expected boolean or { origin?: string }",
    });
  }
}

function validateConfigShape(userConfig: unknown): void {
  validateVeryfrontConfig(userConfig);
  if (!userConfig || typeof userConfig !== "object") return;

  const unknown = findUnknownTopLevelKeys(userConfig as Record<string, unknown>);
  if (unknown.length > 0) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: `Unknown config keys: ${unknown.join(", ")}. Check for typos in veryfront.config.`,
    });
  }
}

function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
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
      },
    },
    dev: {
      ...defaults.dev,
      ...userConfig.dev,
    },
    theme: {
      ...defaults.theme,
      ...userConfig.theme,
    },
    build: {
      ...defaults.build,
      ...userConfig.build,
    },
    cache: {
      ...defaults.cache,
      ...userConfig.cache,
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
  validateConfigShape(userConfig);

  const merged = mergeConfigs(userConfig as Partial<VeryfrontConfig>);

  if (merged.react?.version) {
    serverLogger.debug("[CONFIG] React version from config", { version: merged.react.version });
  }

  configCacheByProject.set(cacheKey, { revision: cacheRevision, config: merged });
  return merged;
}

function isConfigError(error: unknown): boolean {
  if (error instanceof VeryfrontError && error.slug === "config-validation-failed") return true;
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
  // Convert .ts/.tsx to .mjs and strip TypeScript-specific syntax.
  const needsTranspile = isDenoCompiled && (originalExt === ".ts" || originalExt === ".tsx");
  const extension = needsTranspile ? ".mjs" : originalExt;
  const processedSource = needsTranspile ? stripTypeScriptSyntax(source) : source;

  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, `config${extension}`);

  try {
    await fs.writeTextFile(tempFile, processedSource);
    const configModule = await import(loadUrl(tempFile));
    return configModule.default || configModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

/**
 * Strip TypeScript-specific syntax for runtime import in compiled binaries.
 * This is a simple transformation for config files which typically don't use complex TS features.
 */
function stripTypeScriptSyntax(source: string): string {
  return source
    // Remove 'as const' assertions
    .replace(/\s+as\s+const\b/g, "")
    // Remove type annotations (: string, : number, etc.)
    .replace(
      /:\s*(?:string|number|boolean|any|unknown|never|void|null|undefined)(?:\[\])?(?=\s*[,;=\)\}])/g,
      "",
    )
    // Remove 'as Type' assertions
    .replace(/\s+as\s+[A-Z][a-zA-Z0-9]*(?:<[^>]+>)?/g, "")
    // Remove generic type parameters from function calls
    .replace(/<[A-Z][a-zA-Z0-9]*(?:\s*,\s*[A-Z][a-zA-Z0-9]*)*>/g, "");
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
      serverLogger.info("[CONFIG] Loading config from virtual filesystem (API)", { configPath });
      const content = await adapter.fs.readFile(configPath);
      const source = typeof content === "string" ? content : new TextDecoder().decode(content);
      serverLogger.info("[CONFIG] Got config source from API", {
        configPath,
        sourceLength: source.length,
        sourcePreview: source.slice(0, 200),
      });

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => `file://${tempFile}?v=${Date.now()}`,
      );

      serverLogger.info("[CONFIG] Loaded config from virtual filesystem", {
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
  serverLogger.info("[CONFIG] loadAndMergeConfig called", {
    configPath,
    cacheKey,
    isVirtualFS,
    isBun,
    isDenoCompiled,
  });

  if (isVirtualFS) {
    serverLogger.info("[CONFIG] Using virtual filesystem (API) for config", { configPath });
    return loadConfigFromVirtualFS(configPath, cacheKey, adapter);
  }

  // Bun and compiled Deno binaries can't dynamically import TypeScript files directly.
  // We need to read the source, write to a temp file, and import from there.
  if (isBun || isDenoCompiled) {
    serverLogger.info("[CONFIG] Using temp file import for Bun/compiled Deno", {
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
    serverLogger.info("[CONFIG] Successfully loaded config via temp file", {
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

  serverLogger.debug("[CONFIG] getConfig START", { projectDir, cacheKey: cacheKeyForLog });

  return withSpan(
    SpanNames.CONFIG_LOAD,
    async () => {
      const isVirtualFS = isVirtualFilesystem(adapter.fs);
      const effectiveCacheKey = buildConfigCacheKey(
        isVirtualFS && options?.cacheKey ? options.cacheKey : projectDir,
        isVirtualFS && !!options?.cacheKey,
      );

      serverLogger.debug("[CONFIG] Cache key built", {
        effectiveCacheKey,
        isVirtualFS,
        cacheKey: cacheKeyForLog,
      });

      const cached = configCacheByProject.get(effectiveCacheKey);
      if (cached?.revision === cacheRevision) {
        serverLogger.info("[CONFIG] Cache HIT - using cached config", {
          cacheKey: effectiveCacheKey,
          isVirtualFS,
          hasApp: !!cached.config.app,
          hasLayout: !!(cached.config as Record<string, unknown>).layout,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        return cached.config;
      }

      serverLogger.debug("[CONFIG] Cache MISS - loading config", {
        cacheKey: effectiveCacheKey,
        isVirtualFS,
      });

      const configFiles = ["veryfront.config.js", "veryfront.config.ts", "veryfront.config.mjs"];

      // For virtual filesystem, config is at project root ("/"), not the local projectDir
      const configBaseDir = isVirtualFS ? "/" : projectDir;

      for (const configFile of configFiles) {
        const configPath = join(configBaseDir, configFile);
        const exists = await adapter.fs.exists(configPath);
        serverLogger.info("[CONFIG] Checking config file", { configPath, exists, isVirtualFS });
        if (!exists) continue;

        try {
          const merged = await loadAndMergeConfig(configPath, effectiveCacheKey, adapter);
          serverLogger.info("[CONFIG] Successfully loaded config", {
            configFile,
            hasApp: !!merged.app,
            hasLayout: !!(merged as Record<string, unknown>).layout,
            configKeys: Object.keys(merged),
          });
          return merged;
        } catch (error) {
          serverLogger.warn(`[CONFIG] Failed to load ${configFile}, trying next:`, {
            error: getErrorMessage(error),
          });
          if (isConfigError(error)) throw error;
        }
      }

      serverLogger.warn("[CONFIG] No config file found, using defaults", {
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
  const cached = configCacheByProject.get(projectDir);
  if (!cached || cached.revision !== cacheRevision) return null;
  return cached.config;
}
