import type { VeryfrontConfig } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import { extname, join, resolve, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDeno, isDenoCompiled, isNode } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey, type VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import {
  DEFAULT_DEV_HOST,
  DEFAULT_PORT,
  DEFAULT_PROJECT_DESCRIPTION,
  DEFAULT_PROJECT_TITLE,
  DEFAULT_RENDER_CACHE_MAX_ENTRIES,
} from "./defaults.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
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
import { ESBUILD_VERSION } from "#veryfront/platform/compat/esbuild-shared.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import { createImmutableConfigSnapshot } from "./immutable-config.ts";

const logger = serverLogger.component("config");

/** Cache TTL for veryfront-api filesystem in proxy mode */
const DEFAULT_FS_CACHE_TTL_MS = 60_000;
/** Maximum retry attempts for veryfront-api filesystem requests */
const DEFAULT_FS_MAX_RETRIES = 3;
/** Initial backoff delay between retries */
const DEFAULT_FS_INITIAL_DELAY_MS = 500;
/** Maximum backoff delay between retries */
const DEFAULT_FS_MAX_DELAY_MS = 5_000;
/** Maximum entries in the per-project config cache */
const DEFAULT_CONFIG_CACHE_MAX_ENTRIES = 100;
/** Maximum encoded size of config loaded from a multi-tenant virtual filesystem. */
const MAX_VIRTUAL_CONFIG_SOURCE_BYTES = 4 * 1024 * 1024;
/** Maximum accepted length for a host-owned API base URL. */
const MAX_API_BASE_URL_LENGTH = 2_048;

const configSourceEncoder = new TextEncoder();
const configSourceDecoder = new TextDecoder("utf-8", { fatal: true });

export type { VeryfrontConfig } from "./schemas/index.ts";
export type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";

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
  const isProxyMode = isTruthyEnvValue(getHostEnv("PROXY_MODE"));
  const apiBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");

  logger.debug("Resolving default filesystem configuration", { isProxyMode });

  if (isProxyMode) {
    if (!apiBaseUrl) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: "Proxy mode requires VERYFRONT_API_BASE_URL",
      });
    }

    let parsedApiBaseUrl: URL;
    try {
      parsedApiBaseUrl = new URL(apiBaseUrl);
    } catch {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: "Proxy mode requires a safe HTTP or HTTPS API base URL",
      });
    }
    if (
      apiBaseUrl.length > MAX_API_BASE_URL_LENGTH ||
      apiBaseUrl.trim() !== apiBaseUrl ||
      Array.from(apiBaseUrl).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }) ||
      (parsedApiBaseUrl.protocol !== "http:" && parsedApiBaseUrl.protocol !== "https:") ||
      parsedApiBaseUrl.username !== "" ||
      parsedApiBaseUrl.password !== "" ||
      parsedApiBaseUrl.search !== "" ||
      parsedApiBaseUrl.hash !== ""
    ) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: "Proxy mode requires a safe HTTP or HTTPS API base URL",
      });
    }

    logger.debug("Using the Veryfront API filesystem");
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

  logger.debug("Using the local filesystem");
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
    title: DEFAULT_PROJECT_TITLE,
    description: DEFAULT_PROJECT_DESCRIPTION,
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
        wasmURL: `https://deno.land/x/esbuild@v${ESBUILD_VERSION}/esbuild.wasm`,
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
      host: DEFAULT_DEV_HOST,
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
const inFlightConfigLoads = new Map<
  string,
  { revision: number; promise: Promise<VeryfrontConfig> }
>();

function validateConfigShape(userConfig: unknown): VeryfrontConfig {
  return validateVeryfrontConfig(userConfig) as VeryfrontConfig;
}

function mergeFilesystemConfig(
  defaultFs: VeryfrontConfig["fs"],
  userFs: VeryfrontConfig["fs"],
): NonNullable<VeryfrontConfig["fs"]> {
  if (defaultFs?.type === "veryfront-api" && defaultFs.veryfront?.proxyMode === true) {
    const userKeys = userFs ? Object.keys(userFs) : [];
    const hasUnsafeOverride = userKeys.some((key) => key !== "type") ||
      (userFs?.type !== undefined && userFs.type !== "veryfront-api");
    if (hasUnsafeOverride) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: "Project config cannot override filesystem routing in proxy mode",
      });
    }

    const cache = Object.freeze({ ...defaultFs.veryfront.cache });
    const retry = Object.freeze({ ...defaultFs.veryfront.retry });
    const veryfront = Object.freeze({
      ...defaultFs.veryfront,
      cache,
      retry,
    });
    return Object.freeze({
      ...defaultFs,
      veryfront,
    });
  }

  const merged = {
    ...defaultFs,
    ...userFs,
  } as NonNullable<VeryfrontConfig["fs"]>;
  const defaultVeryfrontFs = defaultFs?.veryfront;
  const userVeryfrontFs = userFs?.veryfront;
  if (defaultVeryfrontFs || userVeryfrontFs) {
    merged.veryfront = {
      ...defaultVeryfrontFs,
      ...userVeryfrontFs,
      cache: {
        ...defaultVeryfrontFs?.cache,
        ...userVeryfrontFs?.cache,
      },
      retry: {
        ...defaultVeryfrontFs?.retry,
        ...userVeryfrontFs?.retry,
      },
    };
  } else {
    delete merged.veryfront;
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

  return Object.isFrozen(mergedFs) ? Object.freeze(merged) : merged;
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

  return createImmutableConfigSnapshot(merged);
}

function rejectInvalidVirtualConfigSource(detail: string): never {
  throw CONFIG_PARSE_ERROR.create({ detail });
}

function decodeVirtualConfigSource(content: string | Uint8Array): string {
  if (typeof content === "string") {
    if (content.length > MAX_VIRTUAL_CONFIG_SOURCE_BYTES) {
      rejectInvalidVirtualConfigSource("Virtual project config exceeds the 4 MiB source limit");
    }
    const encoded = configSourceEncoder.encode(content);
    if (encoded.byteLength > MAX_VIRTUAL_CONFIG_SOURCE_BYTES) {
      rejectInvalidVirtualConfigSource("Virtual project config exceeds the 4 MiB source limit");
    }
    return content;
  }

  if (content.byteLength > MAX_VIRTUAL_CONFIG_SOURCE_BYTES) {
    rejectInvalidVirtualConfigSource("Virtual project config exceeds the 4 MiB source limit");
  }

  try {
    return configSourceDecoder.decode(content);
  } catch {
    rejectInvalidVirtualConfigSource("Virtual project config must use valid UTF-8");
  }
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
  const needsTranspile = (isDenoCompiled || isNode) &&
    (originalExt === ".ts" || originalExt === ".tsx");
  const extension = needsTranspile ? ".mjs" : originalExt;
  const processedSource = needsTranspile
    ? await transpileConfigSourceForImport(source, configPath)
    : source;

  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, `config${extension}`);

  try {
    await writeConfigHelperPackage(fs, tempDir);
    const importableSource = isDeno
      ? await resolveConfigHelperImports(processedSource)
      : processedSource;
    await fs.writeTextFile(tempFile, importableSource);
    const configModule = await import(loadUrl(tempFile));
    return readConfigModuleExport(configModule);
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

function readConfigModuleExport(configModule: unknown): unknown {
  if (
    (typeof configModule === "object" && configModule !== null) ||
    typeof configModule === "function"
  ) {
    if (Object.prototype.hasOwnProperty.call(configModule, "default")) {
      return (configModule as { default: unknown }).default;
    }
  }
  return configModule;
}

/**
 * Minimal package used to resolve the bare `veryfront` specifier in temporary
 * user config modules.
 *
 * Config modules loaded through {@link loadConfigFromTempFile} execute from a
 * temp directory, where the host project's import map and package installation
 * are unavailable. Bun and Node resolve a local package through their native
 * ESM rules. Deno import maps take precedence over that package, so exact
 * helper specifiers are rewritten from module-lexer ranges. Only supported
 * project-authoring helpers are exposed.
 */
/** @internal Self-contained helper surface allowed in isolated project config Workers. */
export const VERYFRONT_CONFIG_SHIM = [
  "const readEnv = (key) => {",
  "  try {",
  "    return globalThis.Deno?.env?.get?.(key) ?? globalThis.process?.env?.[key];",
  "  } catch (error) {",
  '    if (error?.name !== "NotCapable") throw error;',
  "    return globalThis.process?.env?.[key];",
  "  }",
  "};",
  "export const defineConfig = (config) => config;",
  "export const defineConfigWithEnv = (factory, envConfig) =>",
  '  factory(envConfig?.nodeEnv ?? readEnv("NODE_ENV") ?? readEnv("DENO_ENV") ?? "development");',
  "export const mergeConfigs = (...configs) => Object.assign({}, ...configs);",
].join("\n");

const CONFIG_HELPER_MODULE_SPECIFIER = "./node_modules/veryfront/index.mjs";
const moduleLexerInitializations = new WeakMap<object, Promise<void>>();

async function resolveConfigHelperImports(source: string): Promise<string> {
  await ensureDefaultBundlerContracts();
  const lexer = resolveExtensionContract<ModuleLexer>("ModuleLexer");
  if (lexer.init) {
    let initialization = moduleLexerInitializations.get(lexer);
    if (!initialization) {
      initialization = lexer.init();
      moduleLexerInitializations.set(lexer, initialization);
    }
    await initialization;
  }

  const imports = [...lexer.parse(source)]
    .filter((entry) => entry.d === -1 && entry.n === "veryfront")
    .sort((left, right) => right.s - left.s);
  let result = source;
  for (const entry of imports) {
    if (
      !Number.isSafeInteger(entry.s) || !Number.isSafeInteger(entry.e) ||
      entry.s < 0 || entry.e < entry.s || entry.e > result.length
    ) {
      throw new TypeError("Module lexer returned an invalid config import range");
    }
    result = result.slice(0, entry.s) + CONFIG_HELPER_MODULE_SPECIFIER + result.slice(entry.e);
  }
  return result;
}

async function writeConfigHelperPackage(
  fs: ReturnType<typeof createFileSystem>,
  tempDir: string,
): Promise<void> {
  const packageDir = join(tempDir, "node_modules", "veryfront");
  await fs.mkdir(packageDir, { recursive: true });
  await Promise.all([
    fs.writeTextFile(
      join(tempDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    ),
    fs.writeTextFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "veryfront", private: true, type: "module", exports: "./index.mjs" }),
    ),
    fs.writeTextFile(join(packageDir, "index.mjs"), VERYFRONT_CONFIG_SHIM),
  ]);
}

/** @internal */
export async function transpileConfigSourceForImport(
  source: string,
  configPath: string,
): Promise<string> {
  await ensureDefaultBundlerContracts();
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
 * Imports through an isolated temporary module and transpiles TypeScript in
 * compiled runtimes that cannot import it directly.
 */
function loadConfigFromVirtualFS(
  configPath: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  return withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      logger.debug("Loading config from the virtual filesystem");
      const content = await adapter.fs.readFile(configPath);
      const source = decodeVirtualConfigSource(content);

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => {
          const url = toFileUrl(tempFile);
          url.searchParams.set("v", crypto.randomUUID());
          return url.href;
        },
      );

      logger.debug("Loaded config from the virtual filesystem");

      return validateAndMergeConfig(userConfig);
    },
    { "config.source": "virtual_fs" },
  );
}

async function loadAndMergeConfig(
  configPath: string,
  adapter: RuntimeAdapter,
): Promise<VeryfrontConfig> {
  const isVirtualFS = isVirtualFilesystem(adapter.fs);
  logger.debug("Loading and merging config", { isVirtualFS, isBun, isDenoCompiled });

  if (isVirtualFS) {
    logger.debug("Using the virtual filesystem for config");
    return loadConfigFromVirtualFS(configPath, adapter);
  }

  // Node and compiled Deno binaries can't dynamically import TypeScript files directly.
  // We need to read the source, write to a temp file, and import from there.
  if (isBun || isDenoCompiled || isNode) {
    logger.debug("Using a temporary config module", { isBun, isDenoCompiled, isNode });
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      configPath,
      (tempFile) => toFileUrl(tempFile).href,
    );
    logger.debug("Loaded config through a temporary module");
    return validateAndMergeConfig(userConfig);
  }

  const absolutePath = resolve(configPath);
  const configUrl = toFileUrl(absolutePath);
  configUrl.searchParams.set("v", crypto.randomUUID());
  const configModule = await import(configUrl.href);
  return validateAndMergeConfig(readConfigModuleExport(configModule));
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
    detail: "Explicit virtual config source does not match the current request context",
  });
}

/** Load, validate, merge, and cache the configuration for one project. */
export function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<VeryfrontConfig> {
  logger.debug("Starting config load");

  return withSpan(
    SpanNames.CONFIG_LOAD,
    async () => {
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

      logger.debug("Resolved config cache policy", { isVirtualFS, usePersistentCache });

      const cached = usePersistentCache ? configCacheByProject.get(effectiveCacheKey) : undefined;
      if (cached?.revision === cacheRevision) {
        logger.debug("Using cached config", { isVirtualFS });
        return cached.config;
      }

      const loadRevision = cacheRevision;
      const loadConfig = async (): Promise<VeryfrontConfig> => {
        logger.debug("Loading uncached config", { isVirtualFS });

        // Virtual filesystems expose project config at their root.
        const configBaseDir = isVirtualFS ? "/" : projectDir;

        for (const configFile of VERYFRONT_CONFIG_FILES) {
          const configPath = join(configBaseDir, configFile);
          let exists: boolean;
          try {
            exists = await adapter.fs.exists(configPath);
          } catch {
            logger.warn("Failed to inspect config file", { configFile });
            throw CONFIG_PARSE_ERROR.create({
              detail: `Failed to inspect ${configFile}`,
              context: { configFile },
            });
          }
          logger.debug("Checked config file", { configFile, exists, isVirtualFS });
          if (!exists) continue;

          try {
            const merged = await loadAndMergeConfig(configPath, adapter);
            if (usePersistentCache && cacheRevision === loadRevision) {
              configCacheByProject.set(effectiveCacheKey, {
                revision: loadRevision,
                config: merged,
              });
            }
            logger.debug("Loaded config file", { configFile });
            return merged;
          } catch (error) {
            if (isConfigError(error)) throw error;
            logger.warn("Failed to load config file", { configFile });
            throw CONFIG_PARSE_ERROR.create({
              detail: `Failed to load ${configFile}`,
              context: { configFile },
            });
          }
        }

        logger.debug("No config file found, using defaults", { isVirtualFS });

        const defaultConfig = createImmutableConfigSnapshot(
          createFreshDefaults() as VeryfrontConfig,
        );
        if (usePersistentCache && cacheRevision === loadRevision) {
          configCacheByProject.set(effectiveCacheKey, {
            revision: loadRevision,
            config: defaultConfig,
          });
        }
        return defaultConfig;
      };

      if (!usePersistentCache) return loadConfig();

      const existingLoad = inFlightConfigLoads.get(effectiveCacheKey);
      if (existingLoad?.revision === loadRevision) {
        logger.debug("Joining config load in progress", { isVirtualFS });
        return existingLoad.promise;
      }

      const promise = loadConfig();
      inFlightConfigLoads.set(effectiveCacheKey, { revision: loadRevision, promise });
      try {
        return await promise;
      } finally {
        if (inFlightConfigLoads.get(effectiveCacheKey)?.promise === promise) {
          inFlightConfigLoads.delete(effectiveCacheKey);
        }
      }
    },
    { "config.source": options?.cacheKey ? "virtual" : "local" },
  );
}

/** Invalidate all cached and in-flight project configuration loads. */
export function clearConfigCache(): void {
  cacheRevision++;
  configCacheByProject.clear();
  inFlightConfigLoads.clear();
}

registerProcessStateReset("config loader", clearConfigCache);

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
