import type { VeryfrontConfig } from "./types.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.ts";
import { extname, join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey } from "../cache/keys.ts";
import { DEFAULT_PORT } from "./defaults.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getErrorMessage } from "../errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

export type { VeryfrontConfig } from "./types.ts";

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

const configCacheByProject = new Map<string, { revision: number; config: VeryfrontConfig }>();
let cacheRevision = 0;

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function validateCorsConfig(userConfig: unknown): void {
  if (!userConfig || typeof userConfig !== "object") return;

  const security = (userConfig as Record<string, unknown>).security as
    | Record<string, unknown>
    | undefined;
  const cors = security?.cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) return;

  const origin = (cors as Record<string, unknown>).origin;
  if (origin !== undefined && typeof origin !== "string") {
    throw new ConfigValidationError(
      "security.cors.origin must be a string. Expected boolean or { origin?: string }",
    );
  }
}

function validateConfigShape(userConfig: unknown): void {
  validateVeryfrontConfig(userConfig);
  if (!userConfig || typeof userConfig !== "object") return;

  const unknown = findUnknownTopLevelKeys(userConfig as Record<string, unknown>);
  if (unknown.length > 0) {
    throw new ConfigValidationError(
      `Unknown config keys: ${unknown.join(", ")}. Check for typos in veryfront.config.`,
    );
  }
}

function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const defaults = createFreshDefaults();

  const merged = {
    ...defaults,
    ...userConfig,
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
    throw new ConfigValidationError(
      `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
    );
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
  if (error instanceof ConfigValidationError) return true;
  return error instanceof Error && error.message.startsWith("Invalid veryfront.config");
}

async function loadConfigFromTempFile(
  source: string,
  configPath: string,
  loadUrl: (tempFile: string) => string,
): Promise<unknown> {
  const fs = createFileSystem();
  const extension = extname(configPath) || ".mjs";
  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, `config${extension}`);

  try {
    await fs.writeTextFile(tempFile, source);
    const configModule = await import(loadUrl(tempFile));
    return configModule.default || configModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

/**
 * Load config from virtual filesystem.
 * Uses Deno's native TypeScript support - no esbuild transpilation needed.
 */
function loadConfigFromVirtualFS(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  return withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      const content = await adapter.fs.readFile(configPath);
      const source = typeof content === "string" ? content : new TextDecoder().decode(content);

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => `file://${tempFile}?v=${Date.now()}`,
      );

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
  if (isVirtualFilesystem(adapter.fs)) {
    return loadConfigFromVirtualFS(configPath, cacheKey, adapter);
  }

  if (isBun) {
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      configPath,
      (tempFile) => `file://${tempFile}`,
    );
    return validateAndCacheConfig(userConfig, cacheKey);
  }

  const configUrl = `file://${configPath}?t=${Date.now()}-${crypto.randomUUID()}`;
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
        serverLogger.debug("[CONFIG] Cache HIT - using cached config", {
          cacheKey: effectiveCacheKey,
          isVirtualFS,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        return cached.config;
      }

      serverLogger.debug("[CONFIG] Cache MISS - loading config", {
        cacheKey: effectiveCacheKey,
        isVirtualFS,
      });

      const configFiles = ["veryfront.config.js", "veryfront.config.ts", "veryfront.config.mjs"];

      for (const configFile of configFiles) {
        const configPath = join(projectDir, configFile);
        if (!(await adapter.fs.exists(configPath))) continue;

        try {
          return await loadAndMergeConfig(configPath, effectiveCacheKey, adapter);
        } catch (error) {
          if (isConfigError(error)) throw error;

          serverLogger.debug(`[CONFIG] Failed to load ${configFile}, trying next:`, {
            error: getErrorMessage(error),
          });
        }
      }

      serverLogger.debug("[CONFIG] No config file found, using defaults", {
        effectiveCacheKey,
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
