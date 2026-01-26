/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */
import { parallelMap, rendererLogger as logger } from "../../../utils/index.js";
import { getLocalAdapter } from "../../../platform/adapters/registry.js";
import { generateHash } from "./cache.js";
import { findLocalLibFile, findSourceFile } from "../file-resolver/index.js";
import { transformToESM } from "../../../transforms/esm-transform.js";
import { getProjectTmpDir } from "../../../modules/react-loader/index.js";
import { generateCacheKey as generateTransformCacheKey, getOrComputeTransform, initializeTransformCache, setCachedTransformAsync, } from "../../../transforms/esm/transform-cache.js";
import { hashString } from "../../../cache/hash.js";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "../../../utils/constants/cache.js";
import { ensureHttpBundlesExist } from "../../../transforms/esm/http-cache.js";
import { getHttpBundleCacheDir } from "../../../utils/cache-dir.js";
// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.js";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.js";
/** Pattern to match HTTP bundle file:// paths in transformed code */
const HTTP_BUNDLE_PATTERN = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
/** Extract HTTP bundle paths from transformed code for proactive recovery */
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
    HTTP_BUNDLE_PATTERN.lastIndex = 0;
    return bundles;
}
/** Cache for created directories to avoid repeated mkdir calls */
const createdDirs = new Set();
/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;
function getModuleCacheKey(filePath, projectId, projectDir) {
    return `${projectId ?? projectDir ?? "default"}:${filePath}`;
}
function decodeFileContent(fileContent) {
    if (typeof fileContent === "string")
        return fileContent;
    return new TextDecoder().decode(fileContent);
}
async function ensureDir(adapter, dir) {
    if (createdDirs.has(dir))
        return;
    try {
        await adapter.fs.mkdir(dir, { recursive: true });
    }
    catch {
        // Directory might already exist, ignore errors
    }
    finally {
        createdDirs.add(dir);
    }
}
async function resolveAliasImport(imp, projectDir, adapter, localAdapter) {
    const relativePath = imp.path.substring(2); // Remove @/ prefix
    if (relativePath.startsWith("lib/")) {
        const depFilePath = await findLocalLibFile(relativePath, localAdapter);
        return { ...imp, relativePath, depFilePath, isLocalLib: true };
    }
    let depFilePath = await findSourceFile(relativePath, projectDir, adapter);
    if (!depFilePath) {
        depFilePath = await findSourceFile(`components/${relativePath}`, projectDir, adapter);
    }
    return { ...imp, relativePath, depFilePath, isLocalLib: false };
}
/**
 * Transform a module and all its @/ dependencies.
 *
 * @param filePath - Path to the module
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param config - Module loader configuration
 * @param useLocalAdapter - Whether to use local adapter for reading
 * @returns Path to the transformed module file
 */
export async function transformModuleWithDeps(filePath, tmpDir, localAdapter, config, useLocalAdapter = false) {
    const { moduleCache, projectDir, projectId, adapter, mode } = config;
    const cacheKey = getModuleCacheKey(filePath, projectId, projectDir);
    const cachedPath = moduleCache.get(cacheKey);
    if (cachedPath)
        return cachedPath;
    const readAdapter = useLocalAdapter ? localAdapter : adapter;
    let fileContent = decodeFileContent(await readAdapter.fs.readFile(filePath));
    const aliasImports = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map((m) => ({ full: m[0], path: m[1] }));
    logger.debug("[ModuleLoader] Processing file:", {
        filePath,
        aliasImportsCount: aliasImports.length,
        aliasImports: aliasImports.map((i) => i.path),
    });
    const resolvedDeps = await parallelMap(aliasImports, (imp) => resolveAliasImport(imp, projectDir, adapter, localAdapter));
    const transformedDeps = await parallelMap(resolvedDeps.filter((d) => d.depFilePath), async (dep) => {
        logger.debug("[ModuleLoader] Found dependency:", {
            path: dep.path,
            depFilePath: dep.depFilePath,
            isLocalLib: dep.isLocalLib,
        });
        const depTempPath = await transformModuleWithDeps(dep.depFilePath, tmpDir, localAdapter, config, dep.isLocalLib);
        return { ...dep, depTempPath };
    });
    for (const dep of transformedDeps) {
        fileContent = fileContent.replace(dep.full, `from "file://${dep.depTempPath}"`);
        logger.debug("[ModuleLoader] Replaced import:", {
            path: dep.path,
            depTempPath: dep.depTempPath,
        });
    }
    for (const dep of resolvedDeps) {
        if (dep.depFilePath)
            continue;
        logger.warn("[ModuleLoader] Could not find dependency:", {
            path: dep.path,
            relativePath: dep.relativePath,
            projectDir,
        });
    }
    const contentHash = hashString(fileContent);
    const effectiveProjectId = projectId ?? projectDir;
    const scopedPath = `${effectiveProjectId}:${filePath}`;
    const transformCacheKey = generateTransformCacheKey(scopedPath, contentHash, true); // ssr=true
    // Initialize transform cache (lazy, only once per pod)
    await initializeTransformCache();
    // Use consolidated transform cache with getOrCompute pattern
    let transformedCode = await getOrComputeTransform(transformCacheKey, () => {
        logger.debug("[ModuleLoader] Transform cache miss, transforming", { filePath });
        return transformToESM(fileContent, filePath, projectDir, adapter, {
            projectId: effectiveProjectId,
            dev: mode === "development",
            ssr: true,
        });
    }, TRANSFORM_CACHE_TTL_SECONDS);
    // Proactively ensure HTTP bundles exist before writing the module.
    // Cached transforms from a different pod may reference file:// paths
    // to HTTP bundles that don't exist locally.
    const bundlePaths = extractHttpBundlePaths(transformedCode);
    if (bundlePaths.length > 0) {
        const cacheDir = getHttpBundleCacheDir();
        const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
        if (failed.length > 0) {
            logger.warn("[ModuleLoader] HTTP bundle recovery failed, re-transforming", {
                filePath,
                failed,
            });
            transformedCode = await transformToESM(fileContent, filePath, projectDir, adapter, {
                projectId: effectiveProjectId,
                dev: mode === "development",
                ssr: true,
            });
            setCachedTransformAsync(transformCacheKey, transformedCode, contentHash, TRANSFORM_CACHE_TTL_SECONDS).catch((error) => {
                logger.debug("[ModuleLoader] Failed to update transform cache after re-transform", {
                    filePath,
                    error,
                });
            });
        }
    }
    const hash = await generateHash(filePath);
    const tempFilePath = `${tmpDir}/mod-${hash}.js`;
    await ensureDir(localAdapter, tmpDir);
    try {
        await localAdapter.fs.writeFile(tempFilePath, transformedCode);
    }
    catch (error) {
        logger.error("[ModuleLoader] Failed to write module:", {
            filePath,
            tempFilePath,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
    moduleCache.set(cacheKey, tempFilePath);
    return tempFilePath;
}
/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(filePath, config) {
    const tmpDir = await getProjectTmpDir(config.projectId ?? config.projectDir);
    const localAdapter = await getLocalAdapter();
    const tempFilePath = await transformModuleWithDeps(filePath, tmpDir, localAdapter, config);
    const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;
    try {
        return await import(moduleUrl);
    }
    catch (error) {
        // If import fails due to missing HTTP bundle, try to recover and retry once
        const errorMsg = error instanceof Error ? error.message : String(error);
        const bundleMatch = errorMsg.match(/veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/);
        if (bundleMatch) {
            const hash = bundleMatch[1];
            logger.warn("[ModuleLoader] Import failed due to missing HTTP bundle, attempting recovery", {
                filePath,
                hash,
            });
            const { recoverHttpBundleByHash } = await import("../../../transforms/esm/http-cache.js");
            const cacheDir = getHttpBundleCacheDir();
            const recovered = await recoverHttpBundleByHash(hash, cacheDir);
            if (recovered) {
                logger.info("[ModuleLoader] HTTP bundle recovered, retrying import", { hash });
                return await import(`file://${tempFilePath}?t=${Date.now()}&retry=1`);
            }
        }
        logger.error("[ModuleLoader] Failed to import module:", {
            filePath,
            tempFilePath,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
