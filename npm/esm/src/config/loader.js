import * as dntShim from "../../_dnt.shims.js";
import { findUnknownTopLevelKeys, validateVeryfrontConfig } from "./schema.js";
import { extname, join } from "../platform/compat/path/index.js";
import { isVirtualFilesystem } from "../platform/adapters/fs/wrapper.js";
import { isBun } from "../platform/compat/runtime.js";
import { serverLogger } from "../utils/logger/logger.js";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "../utils/constants/cdn.js";
import { DEFAULT_CACHE_DIR } from "../utils/constants/server.js";
// React version is now passed per-request via TransformOptions.reactVersion
// No longer using global singleton: import { setReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { buildConfigCacheKey } from "../cache/keys.js";
import { DEFAULT_PORT } from "./defaults.js";
import { createFileSystem } from "../platform/compat/fs.js";
import { getErrorMessage } from "../errors/veryfront-error.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
/**
 * Creates fresh default import map per-request.
 * Previously this was called once at module load, causing all projects to share
 * the same import map object which could be mutated.
 *
 * @see plans/architecture-audit/007.3-default-config-shared-reference.md
 */
function getDefaultImportMapForConfig() {
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
function createFreshDefaults() {
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
            importMap: getDefaultImportMapForConfig(), // Fresh per-request, not module-load-time
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
        throw new ConfigValidationError(`Unknown config keys: ${unknown.join(", ")}. Check for typos in veryfront.config.`);
    }
}
function mergeConfigs(userConfig) {
    // Create fresh defaults per-merge to prevent shared mutable state
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
    };
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
// isVirtualFilesystem is now imported from the shared wrapper module
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
 * Load config from virtual filesystem.
 * Uses Deno's native TypeScript support - no esbuild transpilation needed.
 */
function loadConfigFromVirtualFS(configPath, cacheKey, adapter) {
    return withSpan(SpanNames.CONFIG_LOAD_PROJECT, async () => {
        const fs = createFileSystem();
        const content = await adapter.fs.readFile(configPath);
        const source = typeof content === "string" ? content : new TextDecoder().decode(content);
        // Keep original extension - Deno handles TS/TSX natively
        const extension = extname(configPath) || ".mjs";
        const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
        const tempFile = join(tempDir, `config${extension}`);
        try {
            await fs.writeTextFile(tempFile, source);
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
    if (isVirtualFilesystem(adapter.fs)) {
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
        const isVirtualFS = isVirtualFilesystem(adapter.fs);
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
        const defaultConfig = createFreshDefaults();
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
