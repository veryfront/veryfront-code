import * as dntShim from "../../_dnt.shims.js";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.js";
import { dirname, extname, join } from "../platform/compat/path/index.js";
import { isExtendedFSAdapter } from "../platform/adapters/fs/wrapper.js";
import { isBun } from "../platform/compat/runtime.js";
import { serverLogger } from "../utils/logger/logger.js";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "../utils/constants/cdn.js";
import { DEFAULT_CACHE_DIR } from "../utils/constants/server.js";
// React version is now passed per-request via TransformOptions.reactVersion
// No longer using global singleton: import { setReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { buildConfigCacheKey } from "../cache/keys.js";
import { DEFAULT_PORT } from "./defaults.js";
import { createFileSystem } from "../platform/compat/fs.js";
import { getEsbuildLoader } from "../utils/path-utils.js";
import { getErrorMessage } from "../errors/veryfront-error.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
function getDefaultImportMapForConfig() {
    return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}
const DEFAULT_CONFIG = {
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
const configCacheByProject = new Map();
let cacheRevision = 0;
class ConfigValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConfigValidationError";
    }
}
function validateCorsConfig(userConfig) {
    if (!userConfig || typeof userConfig !== "object")
        return;
    const security = userConfig.security;
    const cors = security?.cors;
    if (!cors || typeof cors !== "object" || Array.isArray(cors))
        return;
    const origin = cors.origin;
    if (origin !== undefined && typeof origin !== "string") {
        throw new ConfigValidationError("security.cors.origin must be a string. Expected boolean or { origin?: string }");
    }
}
function validateConfigShape(userConfig) {
    validateVeryfrontConfig(userConfig);
    if (!userConfig || typeof userConfig !== "object")
        return;
    const unknown = findUnknownTopLevelKeys(userConfig);
    if (unknown.length > 0) {
        serverLogger.warn(`Unknown config keys: ${unknown.join(", ")}. These will be ignored.`);
    }
}
function mergeConfigs(userConfig) {
    const merged = {
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
    };
    const defaultMap = DEFAULT_CONFIG.resolve?.importMap;
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
// Virtual filesystem adapters that require special config loading
const VIRTUAL_FS_ADAPTERS = new Set([
    "VeryfrontFSAdapter",
    "MultiProjectFSAdapter",
    "GitHubFSAdapter",
]);
/**
 * Check if the adapter is using a virtual filesystem (e.g., Veryfront API, GitHub)
 */
function isVirtualFilesystem(adapter) {
    const fs = adapter?.fs;
    if (!fs || typeof fs !== "object")
        return false;
    if (!isExtendedFSAdapter(fs))
        return false;
    if (fs.isVeryfrontAdapter())
        return true;
    return VIRTUAL_FS_ADAPTERS.has(fs.getAdapterType());
}
/**
 * Validate config and cache it.
 *
 * @param userConfig - Raw config object to validate
 * @param cacheKey - Cache key (projectDir for local, projectId:VERSION for API-backed)
 */
function validateAndCacheConfig(userConfig, cacheKey) {
    if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
        throw new ConfigValidationError(`Expected object, received ${userConfig === null ? "null" : typeof userConfig}`);
    }
    validateCorsConfig(userConfig);
    validateConfigShape(userConfig);
    const merged = mergeConfigs(userConfig);
    // React version is now passed per-request via TransformOptions.reactVersion
    // Config stores it at merged.react.version, accessed wherever needed
    if (merged.react?.version) {
        serverLogger.debug("[CONFIG] React version from config", { version: merged.react.version });
    }
    configCacheByProject.set(cacheKey, { revision: cacheRevision, config: merged });
    return merged;
}
/**
 * Load config from virtual filesystem by transpiling TypeScript content
 */
function loadConfigFromVirtualFS(configPath, cacheKey, adapter) {
    return withSpan(SpanNames.CONFIG_LOAD_PROJECT, async () => {
        const fs = createFileSystem();
        const content = await adapter.fs.readFile(configPath);
        const source = typeof content === "string" ? content : new TextDecoder().decode(content);
        const loader = getEsbuildLoader(configPath);
        const transpileResult = await withSpan(SpanNames.CONFIG_TRANSPILE, async () => {
            const { build } = await import("esbuild");
            return build({
                bundle: false,
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
        }, { "config.path": configPath, "config.loader": loader });
        if (transpileResult.errors?.length) {
            const first = transpileResult.errors[0]?.text || "unknown error";
            throw new ConfigValidationError(`Failed to transpile config: ${first}`);
        }
        const js = transpileResult.outputFiles?.[0]?.text ?? "export default {}";
        const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
        const tempFile = join(tempDir, "config.mjs");
        try {
            await fs.writeTextFile(tempFile, js);
            const configModule = await import(`file://${tempFile}?v=${Date.now()}`);
            const userConfig = configModule.default || configModule;
            return validateAndCacheConfig(userConfig, cacheKey);
        }
        finally {
            await fs.remove(tempDir, { recursive: true });
        }
    }, { "config.path": configPath, "config.project_dir": cacheKey, "config.source": "virtual_fs" });
}
async function loadAndMergeConfig(configPath, cacheKey, adapter) {
    if (isVirtualFilesystem(adapter)) {
        return loadConfigFromVirtualFS(configPath, cacheKey, adapter);
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
            return validateAndCacheConfig(userConfig, cacheKey);
        }
        finally {
            await fs.remove(tempDir, { recursive: true });
        }
    }
    const configUrl = `file://${configPath}?t=${Date.now()}-${dntShim.crypto.randomUUID()}`;
    const configModule = await import(configUrl);
    const userConfig = configModule.default || configModule;
    return validateAndCacheConfig(userConfig, cacheKey);
}
function isConfigError(error) {
    if (error instanceof ConfigValidationError)
        return true;
    return error instanceof Error && error.message.startsWith("Invalid veryfront.config");
}
export function getConfig(projectDir, adapter, options) {
    const getConfigStartTime = performance.now();
    const cacheKeyForLog = options?.cacheKey || "unknown";
    serverLogger.debug("[CONFIG] getConfig START", { projectDir, cacheKey: cacheKeyForLog });
    return withSpan(SpanNames.CONFIG_LOAD, async () => {
        const isVirtualFS = isVirtualFilesystem(adapter);
        const effectiveCacheKey = buildConfigCacheKey(isVirtualFS && options?.cacheKey ? options.cacheKey : projectDir, isVirtualFS && !!options?.cacheKey);
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
            const exists = await adapter.fs.exists(configPath);
            if (!exists)
                continue;
            try {
                const merged = await loadAndMergeConfig(configPath, effectiveCacheKey, adapter);
                return merged;
            }
            catch (error) {
                if (isConfigError(error))
                    throw error;
                serverLogger.debug(`[CONFIG] Failed to load ${configFile}, trying next:`, {
                    error: getErrorMessage(error),
                });
            }
        }
        serverLogger.debug("[CONFIG] No config file found, using defaults", {
            effectiveCacheKey,
            duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        const defaultConfig = DEFAULT_CONFIG;
        configCacheByProject.set(effectiveCacheKey, {
            revision: cacheRevision,
            config: defaultConfig,
        });
        return defaultConfig;
    }, { "config.project_dir": projectDir, "config.cache_key": options?.cacheKey || "default" });
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
export function getCachedConfigSync(projectDir) {
    const cached = configCacheByProject.get(projectDir);
    if (!cached || cached.revision !== cacheRevision)
        return null;
    return cached.config;
}
