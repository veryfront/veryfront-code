/**
 * Module Fetcher
 *
 * Fetches and caches ESM modules for MDX rendering.
 * Handles direct file reads, HTTP fallback, and recursive dependency resolution.
 *
 * Features:
 * - Distributed transform cache for cross-pod sharing (Redis/API)
 * - Local filesystem cache for fast repeated access
 * - Parallel nested import resolution
 *
 * @module build/transforms/mdx/esm-module-loader/module-fetcher
 */
import * as dntShim from "../../../../../_dnt.shims.js";
import { join, posix } from "../../../../../deps/deno.land/std@0.220.0/path/mod.js";
import { rendererLogger as logger } from "../../../../utils/index.js";
import { Singleflight } from "../../../../utils/singleflight.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../../observability/tracing/span-names.js";
import { transformToESM } from "../../../esm-transform.js";
import { TRANSFORM_CACHE_VERSION } from "../../../esm/package-registry.js";
import { ensureHttpBundlesExist } from "../../../esm/http-cache.js";
import { getHttpBundleCacheDir } from "../../../../utils/cache-dir.js";
import { LOG_PREFIX_MDX_LOADER, RELATIVE_IMPORT_PATTERN, UNRESOLVED_VF_MODULES_PATTERN, VF_MODULE_IMPORT_PATTERN, } from "../constants.js";
import { getLocalFs, getModulePathCache, saveModulePathCache } from "../cache/index.js";
import { hashString } from "../utils/hash.js";
import { createStubModule } from "../utils/stub-module.js";
import { resolveModuleFile } from "../resolution/file-finder.js";
import { recordSSRModules } from "../../../../modules/manifest/route-module-manifest.js";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "../../../../utils/constants/cache.js";
/**
 * Distributed transform cache for cross-pod sharing.
 * Caches transformed module code in Redis/API so other pods don't need to re-transform.
 */
let distributedTransformCache;
const distributedCacheInit = new Singleflight();
/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;
function getDistributedTransformCache() {
    if (distributedTransformCache !== undefined)
        return Promise.resolve(distributedTransformCache);
    return distributedCacheInit.do("init", async () => {
        try {
            const { CacheBackends } = await import("../../../../cache/backend.js");
            const backend = await CacheBackends.transform();
            // Only use distributed cache if API or Redis (not memory - that's per-process)
            if (backend.type === "memory") {
                distributedTransformCache = null;
                logger.debug(`${LOG_PREFIX_MDX_LOADER} No distributed transform cache (memory only)`);
                return null;
            }
            distributedTransformCache = backend;
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache initialized`, {
                type: backend.type,
            });
            return backend;
        }
        catch (error) {
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to init distributed transform cache`, {
                error,
            });
            distributedTransformCache = null;
            return null;
        }
    });
}
/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 */
function getTransformCacheKey(projectId, normalizedPath, contentHash) {
    return `v${TRANSFORM_CACHE_VERSION}:${projectId}:${normalizedPath}:${contentHash}`;
}
/**
 * Map veryfront/* bare specifiers to /_vf_modules/ paths for MDX module loading.
 * These need to be resolved to file paths because the cached .mjs files are
 * dynamically imported and don't have access to deno.json import maps.
 */
const VERYFRONT_IMPORT_MAP = {
    "veryfront/head": "/_vf_modules/react/components/Head.js",
    "veryfront/router": "/_vf_modules/react/router/index.js",
    "veryfront/context": "/_vf_modules/react/context/index.js",
    "veryfront/fonts": "/_vf_modules/react/fonts/index.js",
};
/**
 * Rewrite veryfront/* imports to /_vf_modules/ paths for MDX module loading.
 */
function rewriteVeryfrontImports(code) {
    return code.replace(/from\s+["'](veryfront\/[^"']+)["']/g, (_match, specifier) => {
        const mapped = VERYFRONT_IMPORT_MAP[specifier];
        return `from "${mapped ?? specifier}"`;
    });
}
function getVersionedPathCacheKey(normalizedPath) {
    return `v${TRANSFORM_CACHE_VERSION}:${normalizedPath}`;
}
/** Pattern to extract HTTP bundle paths from code (file:// paths to veryfront-http-bundle) */
const HTTP_BUNDLE_PATTERN = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
/**
 * Extract HTTP bundle paths and hashes from module code.
 * Used to proactively ensure bundles exist before caching/importing.
 */
function extractHttpBundlePaths(code) {
    const bundles = [];
    const seen = new Set();
    let match;
    while ((match = HTTP_BUNDLE_PATTERN.exec(code)) !== null) {
        const path = match[1];
        const hash = match[2];
        if (!seen.has(hash)) {
            seen.add(hash);
            bundles.push({ path, hash });
        }
    }
    // Reset regex state
    HTTP_BUNDLE_PATTERN.lastIndex = 0;
    return bundles;
}
/**
 * Track modules loaded during current render for manifest recording.
 * Key: renderSessionId, Value: RenderSession
 */
const renderSessions = new Map();
/**
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export function startRenderSession(sessionId, projectSlug, route) {
    renderSessions.set(sessionId, { modules: new Set(), projectSlug, route });
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Started render session`, {
        sessionId,
        projectSlug,
        route,
    });
}
/**
 * End a render session and record loaded modules to the manifest.
 */
export function endRenderSession(sessionId) {
    const session = renderSessions.get(sessionId);
    if (!session) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} End session called but no session found`, { sessionId });
        return;
    }
    const modulePaths = Array.from(session.modules);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} End render session`, {
        sessionId,
        moduleCount: modulePaths.length,
        projectSlug: session.projectSlug,
        route: session.route,
        sampleModules: modulePaths.slice(0, 5),
    });
    if (session.projectSlug !== undefined && session.route !== undefined) {
        if (modulePaths.length > 0)
            recordSSRModules(session.projectSlug, session.route, modulePaths);
        renderSessions.delete(sessionId);
        return;
    }
    // This is normal in local dev/tests where projectSlug isn't set
    // The manifest is an optimization for production, not required
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cannot record to manifest - missing projectSlug or route`, {
        projectSlug: session.projectSlug,
        route: session.route,
    });
    renderSessions.delete(sessionId);
}
/**
 * Get the current active render session (if any).
 * Used to record modules during fetch and for per-session in-flight deduplication.
 */
function getCurrentSession() {
    const firstSession = renderSessions.values().next();
    return firstSession.done ? null : firstSession.value;
}
function recordModuleToSession(normalizedPath) {
    const session = getCurrentSession();
    if (!session)
        return;
    const moduleUrlPath = normalizedPath
        .replace(/^_vf_modules\//, "")
        .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
    session.modules.add(moduleUrlPath);
}
/**
 * Normalize a module path, resolving relative paths if a parent is provided.
 */
function normalizePath(modulePath, parentModulePath) {
    let normalizedPath = modulePath.replace(/^\//, "");
    if (!parentModulePath)
        return normalizedPath;
    if (!modulePath.startsWith("./") && !modulePath.startsWith("../"))
        return normalizedPath;
    const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
    const joinedPath = posix.join(parentDir, modulePath);
    normalizedPath = posix.normalize(joinedPath);
    if (!normalizedPath.startsWith("_vf_modules/"))
        normalizedPath = `_vf_modules/${normalizedPath}`;
    return normalizedPath;
}
/**
 * Find nested module imports in code.
 */
function findNestedImports(moduleCode) {
    const vfModules = [];
    const relative = [];
    const vfPattern = new RegExp(VF_MODULE_IMPORT_PATTERN.source, "g");
    let match;
    while ((match = vfPattern.exec(moduleCode)) !== null) {
        const path = match[1];
        if (path)
            vfModules.push({ original: match[0], path: path.replace(/^\//, "") });
    }
    const relativePattern = new RegExp(RELATIVE_IMPORT_PATTERN.source, "g");
    while ((match = relativePattern.exec(moduleCode)) !== null) {
        const path = match[1];
        if (path)
            relative.push({ original: match[0], path });
    }
    return { vfModules, relative };
}
/**
 * Check for unresolved /_vf_modules/ imports.
 */
function hasUnresolvedImports(moduleCode) {
    const pattern = new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g");
    const matches = [...moduleCode.matchAll(pattern)];
    return {
        count: matches.length,
        paths: matches.map((m) => m[1]).filter((p) => p !== undefined).slice(0, 5),
    };
}
/**
 * Process nested imports by replacing them with file:// paths or stub modules.
 */
async function processNestedImports(moduleCode, results, esmCacheDir) {
    let result = moduleCode;
    for (const { original, nestedFilePath, nestedPath, relativePath } of results) {
        if (nestedFilePath) {
            result = result.replace(original, `from "file://${nestedFilePath}"`);
            continue;
        }
        const modulePath = nestedPath || relativePath || "";
        const stubPath = await createStubModule(modulePath, result, original, esmCacheDir);
        if (stubPath)
            result = result.replace(original, `from "file://${stubPath}"`);
    }
    return result;
}
/**
 * Write module to cache and return the cache path.
 */
async function cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache) {
    const unresolved = hasUnresolvedImports(moduleCode);
    if (unresolved.count > 0) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.count} unresolved imports, skipping cache`, { path: normalizedPath, unresolved: unresolved.paths });
        return null;
    }
    const contentHash = hashString(normalizedPath + moduleCode);
    const cachePath = join(esmCacheDir, `vfmod-v${TRANSFORM_CACHE_VERSION}-${contentHash}.mjs`);
    const localFs = getLocalFs();
    try {
        const stat = await localFs.stat(cachePath);
        if (stat?.isFile) {
            pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
            recordModuleToSession(normalizedPath);
            return cachePath;
        }
    }
    catch {
        // Not cached, write it
    }
    await localFs.mkdir(esmCacheDir, { recursive: true });
    await localFs.writeTextFile(cachePath, moduleCode);
    pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
    await saveModulePathCache(esmCacheDir);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);
    recordModuleToSession(normalizedPath);
    return cachePath;
}
/**
 * Fetch module via HTTP as a fallback.
 */
async function fetchModuleViaHTTP(normalizedPath, adapter, fetchAndCacheModuleFn, projectSlug, isLocalDev) {
    if (!isLocalDev) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`);
        return null;
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`);
    const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
    const host = projectSlug ? `${projectSlug}.lvh.me` : "localhost";
    const moduleUrl = `http://${host}:${port}/${normalizedPath}?ssr=true`;
    const response = await withSpan(SpanNames.HTTP_CLIENT_FETCH, () => dntShim.fetch(moduleUrl), {
        "http.method": "GET",
        "http.url": moduleUrl,
        "http.target": `/${normalizedPath}`,
        "http.host": host,
        "mdx.module_path": normalizedPath,
    });
    if (!response.ok) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`);
        return null;
    }
    let moduleCode = rewriteVeryfrontImports(await response.text());
    const { vfModules, relative } = findNestedImports(moduleCode);
    const allImports = [
        ...vfModules.map(({ original, path }) => ({ original, path, key: "nestedPath" })),
        ...relative.map(({ original, path }) => ({ original, path, key: "relativePath" })),
    ];
    const results = await Promise.all(allImports.map(async ({ original, path, key }) => {
        const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
        return { original, nestedFilePath, [key]: path };
    }));
    for (const { original, nestedFilePath } of results) {
        if (nestedFilePath) {
            moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
        }
    }
    return moduleCode;
}
/**
 * Fetch and cache a module.
 * This is the main entry point for module fetching operations.
 */
export async function fetchAndCacheModule(modulePath, context, parentModulePath) {
    const normalizedPath = normalizePath(modulePath, parentModulePath);
    const projectSlug = context.projectSlug || "unknown";
    const inFlight = context.inFlightModules;
    const existingPromise = inFlight?.get(normalizedPath);
    if (existingPromise) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] CIRCULAR IMPORT detected`, {
            projectSlug,
            normalizedPath,
            parentModulePath,
        });
        return existingPromise;
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] START`, {
        projectSlug,
        modulePath,
        normalizedPath,
        parentModulePath,
    });
    const fetchAndCacheModuleFn = (path, parent) => fetchAndCacheModule(path, context, parent);
    const fetchPromise = doFetchAndCacheModule(normalizedPath, context, fetchAndCacheModuleFn, projectSlug);
    inFlight?.set(normalizedPath, fetchPromise);
    try {
        const result = await fetchPromise;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] DONE`, {
            projectSlug,
            normalizedPath,
            hasResult: result !== null,
        });
        return result;
    }
    finally {
        inFlight?.delete(normalizedPath);
    }
}
/**
 * Internal implementation of module fetching.
 */
async function doFetchAndCacheModule(normalizedPath, context, fetchAndCacheModuleFn, projectSlug) {
    const { esmCacheDir, adapter, projectDir, projectId } = context;
    const pathCache = await getModulePathCache(esmCacheDir);
    const versionedKey = getVersionedPathCacheKey(normalizedPath);
    const cachedPath = pathCache.get(versionedKey);
    if (cachedPath) {
        try {
            const stat = await getLocalFs().stat(cachedPath);
            if (stat?.isFile) {
                // Verify HTTP bundles in cached module exist before returning
                // The cached module may reference file:// paths to HTTP bundles that
                // were created on a different pod and may not exist locally
                const cachedCode = await getLocalFs().readTextFile(cachedPath);
                const bundlePaths = extractHttpBundlePaths(cachedCode);
                if (bundlePaths.length > 0) {
                    const cacheDir = getHttpBundleCacheDir();
                    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
                    if (failed.length > 0) {
                        logger.warn(`${LOG_PREFIX_MDX_LOADER} Cached module has missing HTTP bundles`, {
                            normalizedPath,
                            cachedPath,
                            failed,
                        });
                        // Invalidate this cache entry - HTTP bundles can't be recovered
                        pathCache.delete(versionedKey);
                        // Continue to re-transform
                    }
                    else {
                        recordModuleToSession(normalizedPath);
                        return cachedPath;
                    }
                }
                else {
                    recordModuleToSession(normalizedPath);
                    return cachedPath;
                }
            }
        }
        catch {
            // Cache entry is stale, remove it
            pathCache.delete(versionedKey);
        }
    }
    try {
        const resolved = await resolveModuleFile(normalizedPath, adapter, projectDir);
        if (!resolved) {
            const moduleCode = await fetchModuleViaHTTP(normalizedPath, adapter, fetchAndCacheModuleFn, projectSlug, context.isLocalDev);
            return moduleCode
                ? await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache)
                : null;
        }
        const { sourceCode, actualFilePath } = resolved;
        const contentHash = hashString(sourceCode);
        const transformCacheKey = getTransformCacheKey(projectId, normalizedPath, contentHash);
        let moduleCode = null;
        const distributedCache = await getDistributedTransformCache();
        if (distributedCache) {
            try {
                const cached = await distributedCache.get(transformCacheKey);
                if (cached) {
                    moduleCode = cached;
                    logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache HIT`, {
                        projectSlug,
                        normalizedPath,
                        cacheKey: transformCacheKey,
                    });
                    // CRITICAL: Proactively ensure HTTP bundles exist before using cached code
                    // The cached code may have file:// paths to HTTP bundles that were created
                    // on a different pod. Fetch any missing bundles from distributed cache now.
                    const bundlePaths = extractHttpBundlePaths(cached);
                    if (bundlePaths.length > 0) {
                        const cacheDir = getHttpBundleCacheDir();
                        const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
                        if (failed.length > 0) {
                            logger.warn(`${LOG_PREFIX_MDX_LOADER} Some HTTP bundles could not be recovered`, {
                                normalizedPath,
                                failed,
                            });
                            // Don't use cached code if bundles can't be recovered - will re-transform
                            moduleCode = null;
                        }
                    }
                }
            }
            catch (error) {
                logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache get failed`, {
                    normalizedPath,
                    error,
                });
            }
        }
        if (!moduleCode) {
            logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM START`, {
                projectSlug,
                normalizedPath,
                actualFilePath,
                sourceLength: sourceCode.length,
            });
            const transformStart = performance.now();
            try {
                moduleCode = await transformToESM(sourceCode, actualFilePath, projectDir, adapter, {
                    projectId,
                    dev: true,
                    ssr: true,
                });
            }
            catch (transformError) {
                logger.error(`${LOG_PREFIX_MDX_LOADER} Transform failed for module`, {
                    normalizedPath,
                    actualFilePath,
                    sourceLength: sourceCode.length,
                    sourcePreview: sourceCode.slice(0, 200),
                    error: transformError instanceof Error ? transformError.message : String(transformError),
                });
                throw transformError;
            }
            logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM DONE`, {
                projectSlug,
                normalizedPath,
                transformMs: (performance.now() - transformStart).toFixed(1),
                outputLength: moduleCode.length,
            });
            // Cached .mjs files don't have access to deno.json import maps
            moduleCode = rewriteVeryfrontImports(moduleCode);
            if (distributedCache) {
                distributedCache
                    .set(transformCacheKey, moduleCode, TRANSFORM_CACHE_TTL_SECONDS)
                    .catch((error) => {
                    logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache set failed`, {
                        normalizedPath,
                        error,
                    });
                });
            }
        }
        const { vfModules, relative } = findNestedImports(moduleCode);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] found nested imports`, {
            projectSlug,
            normalizedPath,
            vfModulesCount: vfModules.length,
            relativeCount: relative.length,
            vfModulePaths: vfModules.map((m) => m.path).slice(0, 5),
            relativePaths: relative.map((m) => m.path).slice(0, 5),
        });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules START`, {
            projectSlug,
            normalizedPath,
            count: vfModules.length,
        });
        const vfStart = performance.now();
        const nestedResults = await Promise.all(vfModules.map(async ({ original, path }) => ({
            original,
            nestedFilePath: await fetchAndCacheModuleFn(path, normalizedPath),
            nestedPath: path,
        })));
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules DONE`, {
            projectSlug,
            normalizedPath,
            vfMs: (performance.now() - vfStart).toFixed(1),
        });
        moduleCode = await processNestedImports(moduleCode, nestedResults, esmCacheDir);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports START`, {
            projectSlug,
            normalizedPath,
            count: relative.length,
        });
        const relStart = performance.now();
        const relativeResults = await Promise.all(relative.map(async ({ original, path }) => ({
            original,
            nestedFilePath: await fetchAndCacheModuleFn(path, normalizedPath),
            relativePath: path,
        })));
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports DONE`, {
            projectSlug,
            normalizedPath,
            relMs: (performance.now() - relStart).toFixed(1),
        });
        moduleCode = await processNestedImports(moduleCode, relativeResults, esmCacheDir);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule START`, {
            projectSlug,
            normalizedPath,
        });
        const cacheStart = performance.now();
        const finalCachedPath = await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule DONE`, {
            projectSlug,
            normalizedPath,
            cacheMs: (performance.now() - cacheStart).toFixed(1),
        });
        return finalCachedPath;
    }
    catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
        return null;
    }
}
/**
 * Create a module fetcher context.
 */
export function createModuleFetcherContext(esmCacheDir, adapter, projectDir, projectId, options) {
    return {
        esmCacheDir,
        adapter,
        projectDir,
        projectId,
        ...options,
        // Initialize in-flight tracking for circular import detection
        inFlightModules: new Map(),
    };
}
