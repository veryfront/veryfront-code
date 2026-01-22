import type { VeryfrontConfig } from "./types.ts";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.ts";
import { dirname, extname, join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey } from "../cache/keys.ts";
import { DEFAULT_PORT } from "./defaults.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getEsbuildLoader } from "../utils/path-utils.ts";
import { getErrorMessage } from "../errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

export type { VeryfrontConfig } from "./types.ts";

function getDefaultImportMapForConfig() {
  return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}

const DEFAULT_CONFIG: Partial<VeryfrontConfig> = {
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

const configCacheByProject = new Map<string, { revision: number; config: VeryfrontConfig }>();
let cacheRevision = 0;

function validateCorsConfig(userConfig: unknown): void {
  if (!userConfig || typeof userConfig !== "object") {
    return;
  }
  const config = userConfig as Record<string, unknown>;
  const security = config.security as Record<string, unknown> | undefined;
  const cors = security?.cors;
  if (!cors || typeof cors !== "object" || Array.isArray(cors)) {
    return;
  }

  const corsObj = cors as Record<string, unknown>;
  const origin = corsObj.origin;
  if (origin !== undefined && typeof origin !== "string") {
    throw new ConfigValidationError(
      "security.cors.origin must be a string. Expected boolean or { origin?: string }",
    );
  }
}

function validateConfigShape(userConfig: unknown): void {
  validateVeryfrontConfig(userConfig);
  if (typeof userConfig !== "object" || !userConfig) return;

  const unknown = findUnknownTopLevelKeys(userConfig as Record<string, unknown>);
  if (unknown.length > 0) {
    serverLogger.warn(`Unknown config keys: ${unknown.join(", ")}. These will be ignored.`);
  }
}

function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const merged: VeryfrontConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    dev: {
      ...DEFAULT_CONFIG.dev,
      ...userConfig.dev,
    },
    theme: {
      ...DEFAULT_CONFIG.theme,
      ...userConfig.theme,
    },
    build: {
      ...DEFAULT_CONFIG.build,
      ...userConfig.build,
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...userConfig.cache,
    },
    resolve: {
      ...DEFAULT_CONFIG.resolve,
      ...userConfig.resolve,
    },
    client: {
      ...DEFAULT_CONFIG.client,
      ...userConfig.client,
      cdn: {
        ...DEFAULT_CONFIG.client?.cdn,
        ...userConfig.client?.cdn,
      },
    },
  } as VeryfrontConfig;

  if (merged.resolve) {
    const defaultMap = DEFAULT_CONFIG.resolve?.importMap;
    const userMap = userConfig.resolve?.importMap;

    if (defaultMap || userMap) {
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
  }

  return merged;
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// Virtual filesystem adapters that require special config loading
const VIRTUAL_FS_ADAPTERS = new Set([
  "VeryfrontFSAdapter",
  "MultiProjectFSAdapter",
  "GitHubFSAdapter",
]);

/**
 * Check if the adapter is using a virtual filesystem (e.g., Veryfront API, GitHub)
 */
function isVirtualFilesystem(adapter: RuntimeAdapter): boolean {
  const fs = adapter?.fs;
  if (!fs || typeof fs !== "object") return false;

  if (isExtendedFSAdapter(fs)) {
    // Check for Veryfront adapter first (most common case)
    if (fs.isVeryfrontAdapter()) {
      return true;
    }
    // Check adapter type for other virtual filesystems (e.g., GitHub)
    return VIRTUAL_FS_ADAPTERS.has(fs.getAdapterType());
  }

  return false;
}

/**
 * Load config from virtual filesystem by transpiling TypeScript content
 */
async function loadConfigFromVirtualFS(
  configPath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig | null> {
  return await withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      const fs = createFileSystem();

      // Read config content via adapter
      const content = await adapter.fs.readFile(configPath);
      const source = typeof content === "string" ? content : new TextDecoder().decode(content);

      serverLogger.debug(`[CONFIG] Loading config from virtual FS: ${configPath}`);

      const loader = getEsbuildLoader(configPath);

      // Transpile TypeScript to JavaScript using esbuild
      const transpileResult = await withSpan(
        SpanNames.CONFIG_TRANSPILE,
        async () => {
          const { build } = await import("esbuild");
          return build({
            bundle: false, // Config files shouldn't need bundling
            write: false,
            format: "esm",
            platform: "neutral",
            target: "es2022",
            stdin: {
              contents: source,
              loader,
              resolveDir: dirname(configPath),
              sourcefile: configPath,
            },
          });
        },
        { "config.path": configPath, "config.loader": loader },
      );

      if (transpileResult.errors && transpileResult.errors.length > 0) {
        const first = transpileResult.errors[0]?.text || "unknown error";
        throw new ConfigValidationError(`Failed to transpile config: ${first}`);
      }

      const js = transpileResult.outputFiles?.[0]?.text ?? "export default {}";

      // Write to temp file and import
      const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
      const tempFile = join(tempDir, "config.mjs");

      try {
        await fs.writeTextFile(tempFile, js);
        const configModule = await import(`file://${tempFile}?v=${Date.now()}`);
        const userConfig = configModule.default || configModule;

        // projectDir here is actually the effectiveCacheKey (includes projectId/slug and VERSION)
        // so caching is safe even for virtual filesystem
        return validateAndCacheConfig(userConfig, projectDir);
      } finally {
        await fs.remove(tempDir, { recursive: true });
      }
    },
    { "config.path": configPath, "config.project_dir": projectDir, "config.source": "virtual_fs" },
  );
}

/**
 * Validate config and cache it.
 *
 * @param userConfig - Raw config object to validate
 * @param cacheKey - Cache key (projectDir for local, projectId:VERSION for API-backed)
 */
function validateAndCacheConfig(
  userConfig: unknown,
  cacheKey: string,
): VeryfrontConfig {
  if (userConfig === null || typeof userConfig !== "object" || Array.isArray(userConfig)) {
    throw new ConfigValidationError(
      `Expected object, received ${userConfig === null ? "null" : typeof userConfig}`,
    );
  }

  validateCorsConfig(userConfig);
  validateConfigShape(userConfig);

  const merged = mergeConfigs(userConfig as Partial<VeryfrontConfig>);
  configCacheByProject.set(cacheKey, { revision: cacheRevision, config: merged });

  return merged;
}

async function loadAndMergeConfig(
  configPath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig | null> {
  // Check if using virtual filesystem
  if (isVirtualFilesystem(adapter)) {
    return loadConfigFromVirtualFS(configPath, projectDir, adapter);
  }

  if (isBun) {
    // Bun caches file:// imports by path only (query params are ignored).
    // Copy to a temp file each load to ensure we get fresh config content.
    const fs = createFileSystem();
    const extension = extname(configPath) || ".mjs";
    const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
    const tempFile = join(tempDir, `config${extension}`);

    try {
      const source = await fs.readTextFile(configPath);
      await fs.writeTextFile(tempFile, source);
      const configModule = await import(`file://${tempFile}`);
      const userConfig = configModule.default || configModule;
      return validateAndCacheConfig(userConfig, projectDir);
    } finally {
      await fs.remove(tempDir, { recursive: true });
    }
  }

  // Local filesystem - use direct import
  const configUrl = `file://${configPath}?t=${Date.now()}-${crypto.randomUUID()}`;
  const configModule = await import(configUrl);
  const userConfig = configModule.default || configModule;

  return validateAndCacheConfig(userConfig, projectDir);
}

function isConfigError(error: unknown): boolean {
  if (error instanceof ConfigValidationError) return true;
  return error instanceof Error && error.message.startsWith("Invalid veryfront.config");
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

export async function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<VeryfrontConfig> {
  const getConfigStartTime = performance.now();
  const cacheKeyForLog = options?.cacheKey || "unknown";

  serverLogger.info("[CONFIG] getConfig START", {
    projectDir,
    cacheKey: cacheKeyForLog,
  });

  return await withSpan(
    SpanNames.CONFIG_LOAD,
    async () => {
      // Build cache key using centralized builder
      // For virtual filesystem: vf:{projectId}:{version}
      // For local filesystem: {projectDir}:{version}
      const isVirtualFS = isVirtualFilesystem(adapter);
      const effectiveCacheKey = buildConfigCacheKey(
        isVirtualFS && options?.cacheKey ? options.cacheKey : projectDir,
        isVirtualFS && !!options?.cacheKey,
      );

      serverLogger.info("[CONFIG] Cache key built", {
        effectiveCacheKey,
        isVirtualFS,
        cacheKey: cacheKeyForLog,
      });

      const cached = configCacheByProject.get(effectiveCacheKey);
      if (cached && cached.revision === cacheRevision) {
        serverLogger.info("[CONFIG] Cache HIT - using cached config", {
          cacheKey: effectiveCacheKey,
          isVirtualFS,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        return cached.config;
      }

      serverLogger.info("[CONFIG] Cache MISS - loading config", {
        cacheKey: effectiveCacheKey,
        isVirtualFS,
      });

      const configFiles = ["veryfront.config.js", "veryfront.config.ts", "veryfront.config.mjs"];

      for (const configFile of configFiles) {
        const configPath = join(projectDir, configFile);

        serverLogger.info("[CONFIG] Checking config file existence", {
          configFile,
          configPath,
          cacheKey: cacheKeyForLog,
        });

        const existsStart = performance.now();
        const exists = await adapter.fs.exists(configPath);
        serverLogger.info("[CONFIG] Config file existence check done", {
          configFile,
          exists,
          duration: `${(performance.now() - existsStart).toFixed(2)}ms`,
          cacheKey: cacheKeyForLog,
        });

        if (!exists) continue;

        try {
          serverLogger.info("[CONFIG] Loading config file START", {
            configFile,
            configPath,
            cacheKey: cacheKeyForLog,
          });
          const loadStart = performance.now();
          const merged = await loadAndMergeConfig(configPath, effectiveCacheKey, adapter);
          serverLogger.info("[CONFIG] Loading config file DONE", {
            configFile,
            duration: `${(performance.now() - loadStart).toFixed(2)}ms`,
            totalDuration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
            cacheKey: cacheKeyForLog,
          });
          if (merged) return merged;
        } catch (error) {
          if (isConfigError(error)) throw error;

          // Expected when .ts exists but .js is tried first
          serverLogger.debug(`[CONFIG] Failed to load ${configFile}, trying next:`, {
            error: getErrorMessage(error),
          });
        }
      }

      serverLogger.info("[CONFIG] No config file found, using defaults", {
        effectiveCacheKey,
        duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
      });

      const defaultConfig = DEFAULT_CONFIG as VeryfrontConfig;
      configCacheByProject.set(effectiveCacheKey, {
        revision: cacheRevision,
        config: defaultConfig,
      });
      return defaultConfig;
    },
    { "config.project_dir": projectDir, "config.cache_key": options?.cacheKey || "default" },
  );
}

export function clearConfigCache() {
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
  if (!cached || cached.revision !== cacheRevision) {
    return null;
  }
  return cached.config;
}
