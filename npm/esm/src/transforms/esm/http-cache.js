/**
 * HTTP module cache for SSR.
 *
 * Fetches HTTP(S) modules (esm.sh, deno.land, etc.), rewrites their imports to
 * local file:// paths, and caches them on disk for runtime-agnostic loading.
 *
 * @module transforms/esm/http-cache
 */
import * as dntShim from "../../../_dnt.shims.js";
import { createFileSystem, exists } from "../../platform/compat/fs.js";
import { isAbsolute, join } from "../../platform/compat/path/index.js";
import { cwd } from "../../platform/compat/process.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { simpleHash } from "../../utils/hash-utils.js";
import { LRUCache } from "../../utils/lru-wrapper.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
import { resolveImport } from "../../modules/import-map/resolver.js";
import { isDeno } from "../../platform/compat/runtime.js";
import { getDenoNpmReactMap, getReactImportMap, REACT_VERSION } from "./package-registry.js";
import { parseImports, replaceSpecifiers } from "./lexer.js";
import { CacheBackends, createDistributedCacheAccessor } from "../../cache/backend.js";
import { HTTP_MODULE_CACHE_MAX_ENTRIES, HTTP_MODULE_DISTRIBUTED_TTL_SEC, } from "../../utils/constants/cache.js";
/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(() => CacheBackends.httpModule(), "HTTP-CACHE");
/** TTL for cached modules in distributed cache (uses centralized config) */
const DISTRIBUTED_CACHE_TTL_SECONDS = HTTP_MODULE_DISTRIBUTED_TTL_SEC;
const cachedPaths = new LRUCache({ maxEntries: HTTP_MODULE_CACHE_MAX_ENTRIES });
const processingStack = new Set();
function ensureAbsoluteDir(path) {
    return isAbsolute(path) ? path : join(cwd(), path);
}
function isHttpUrl(specifier) {
    return specifier.startsWith("https://") || specifier.startsWith("http://");
}
/**
 * Check if a URL is for React core packages.
 *
 * Previously, React modules were NOT cached to prevent multiple React instances.
 * Now with npm: specifiers for Deno (which auto-deduplicate) and consistent
 * esm.sh URLs with external=react for other runtimes, all code uses the same
 * React instance.
 */
function isReactCoreUrl(_url) {
    return false;
}
function isExternalScheme(specifier) {
    return specifier.startsWith("node:") ||
        specifier.startsWith("data:") ||
        specifier.startsWith("file:") ||
        specifier.startsWith("bun:");
}
function isRelative(specifier) {
    return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}
function isInternalBare(specifier) {
    return specifier.startsWith("veryfront/") ||
        specifier.startsWith("@veryfront/") ||
        specifier.startsWith("@std/");
}
function normalizeEsmShUrl(url) {
    if (url.hostname !== "esm.sh")
        return;
    if (url.pathname.includes("/denonext/")) {
        url.pathname = url.pathname.replace("/denonext/", "/");
    }
    if (!url.searchParams.has("target")) {
        url.searchParams.set("target", "es2022");
    }
    const pathname = url.pathname.replace(/^\/+/, "");
    // Only skip external for BASE React package (react@version), not subpaths.
    // React subpaths (jsx-runtime, etc.) and react-dom need external=react.
    const isBaseReact = /^react@[\d.]+(?:\?|$)/.test(pathname);
    if (isBaseReact)
        return;
    // Add external=react to ensure all packages use the same React instance.
    // Note: We use external=react only, NOT external=react,react-dom because
    // externalizing react-dom breaks its internal imports.
    const existing = url.searchParams.get("external");
    const externals = existing ? existing.split(",") : [];
    if (!externals.includes("react")) {
        externals.push("react");
        url.searchParams.set("external", externals.join(","));
    }
}
function normalizeHttpUrl(raw) {
    try {
        const url = new URL(raw);
        normalizeEsmShUrl(url);
        url.searchParams.sort();
        return url.toString();
    }
    catch {
        return raw;
    }
}
function toEsmShUrlFromNpm(specifier) {
    return `https://esm.sh/${specifier.slice(4)}`;
}
function resolveBareSpecifier(specifier, importMap, reactVersion = REACT_VERSION) {
    // For Deno SSR: Resolve React to npm: specifiers for automatic deduplication.
    // Deno's native npm resolution ensures all modules share the same React instance.
    // See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
    if (isDeno) {
        const denoReactMap = getDenoNpmReactMap(reactVersion);
        const denoMatch = denoReactMap[specifier];
        if (denoMatch)
            return denoMatch;
        // For unknown react/* or react-dom/* subpaths, construct npm: specifiers
        if (specifier.startsWith("react/") && !specifier.startsWith("react-dom")) {
            const subpath = specifier.slice("react/".length);
            return `npm:react@${reactVersion}/${subpath}`;
        }
        if (specifier.startsWith("react-dom/")) {
            const subpath = specifier.slice("react-dom/".length);
            return `npm:react-dom@${reactVersion}/${subpath}`;
        }
    }
    // For non-Deno runtimes: Use esm.sh URLs with consistent versioning.
    const reactMap = getReactImportMap(reactVersion);
    const reactMapped = reactMap[specifier];
    if (reactMapped)
        return reactMapped;
    if (specifier.startsWith("react/")) {
        const subpath = specifier.slice("react/".length);
        return `https://esm.sh/react@${reactVersion}/${subpath}?external=react&target=es2022`;
    }
    if (specifier.startsWith("react-dom/")) {
        const subpath = specifier.slice("react-dom/".length);
        return `https://esm.sh/react-dom@${reactVersion}/${subpath}?external=react&target=es2022`;
    }
    const mapped = resolveImport(specifier, importMap);
    if (mapped !== specifier)
        return mapped;
    return `https://esm.sh/${specifier}?target=es2022`;
}
async function cacheHttpModule(url, options) {
    const normalizedUrl = normalizeHttpUrl(url);
    if (isReactCoreUrl(normalizedUrl)) {
        logger.debug("[HTTP-CACHE] Skipping React core module (prevents multiple instances)", {
            url: normalizedUrl,
        });
        return null;
    }
    const cacheDir = ensureAbsoluteDir(options.cacheDir);
    const cacheKey = `${cacheDir}:${normalizedUrl}`;
    const existing = cachedPaths.get(cacheKey);
    if (existing)
        return existing;
    const cachePath = join(cacheDir, `http-${simpleHash(normalizedUrl)}.mjs`);
    const fs = createFileSystem();
    if (await exists(cachePath)) {
        cachedPaths.set(cacheKey, cachePath);
        // Synchronously ensure code:{hash} exists in distributed cache for cross-pod recovery
        // This backfills bundles created before code:{hash} storage was added
        // Synchronous to guarantee data is stored before other pods need it
        const distributed = await getDistributedCache();
        if (distributed) {
            const hash = simpleHash(normalizedUrl);
            try {
                const hasCode = await distributed.get(`code:${hash}`);
                if (!hasCode) {
                    const code = await fs.readTextFile(cachePath);
                    await distributed.set(`code:${hash}`, code, DISTRIBUTED_CACHE_TTL_SECONDS);
                    logger.info("[HTTP-CACHE] Backfilled code:{hash} for existing bundle", { hash });
                }
            }
            catch (error) {
                // Log but don't fail - backfill is best-effort
                logger.debug("[HTTP-CACHE] Backfill failed, continuing", { hash, error });
            }
        }
        return cachePath;
    }
    if (processingStack.has(normalizedUrl)) {
        logger.debug("[HTTP-CACHE] Circular dependency detected, returning expected path", {
            url: normalizedUrl,
        });
        return cachePath;
    }
    const distributed = await getDistributedCache();
    if (distributed) {
        try {
            const cachedCode = await distributed.get(normalizedUrl);
            if (cachedCode) {
                logger.debug("[HTTP-CACHE] Distributed cache hit", { url: normalizedUrl });
                await fs.mkdir(cacheDir, { recursive: true });
                await fs.writeTextFile(cachePath, cachedCode);
                cachedPaths.set(cacheKey, cachePath);
                return cachePath;
            }
        }
        catch (error) {
            logger.debug("[HTTP-CACHE] Distributed cache get failed", { url: normalizedUrl, error });
        }
    }
    logger.debug("[HTTP-CACHE] Fetching from network", { url: normalizedUrl });
    const urlObj = new URL(normalizedUrl);
    const controller = new AbortController();
    const timeout = dntShim.setTimeout(() => controller.abort(), 30000);
    const response = await withSpan(SpanNames.HTTP_CLIENT_FETCH, () => dntShim.fetch(normalizedUrl, {
        headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
        signal: controller.signal,
        redirect: "follow",
    }), {
        "http.method": "GET",
        "http.url": normalizedUrl,
        "http.host": urlObj.host,
        "http.scheme": urlObj.protocol.replace(":", ""),
        "esm.package_fetch": true,
    });
    clearTimeout(timeout);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
    }
    let code = await response.text();
    processingStack.add(normalizedUrl);
    try {
        code = await rewriteModuleImports(code, normalizedUrl, options);
    }
    finally {
        processingStack.delete(normalizedUrl);
    }
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(cachePath, code);
    if (distributed) {
        // Store code by URL, by hash (for direct recovery), and URL mapping (for debugging).
        // Storing code by hash enables recovery without needing URL lookup.
        // IMPORTANT: await the writes so other pods can recover this bundle immediately.
        // Without await, a transform referencing this bundle could reach Redis before
        // the bundle code does, causing ensureHttpBundlesExist on another pod to miss.
        const hash = simpleHash(normalizedUrl);
        try {
            await Promise.all([
                distributed.set(normalizedUrl, code, DISTRIBUTED_CACHE_TTL_SECONDS),
                distributed.set(`code:${hash}`, code, DISTRIBUTED_CACHE_TTL_SECONDS),
                distributed.set(`hash:${hash}`, normalizedUrl, DISTRIBUTED_CACHE_TTL_SECONDS),
            ]);
        }
        catch (error) {
            logger.debug("[HTTP-CACHE] Distributed cache set failed", { url: normalizedUrl, error });
        }
    }
    cachedPaths.set(cacheKey, cachePath);
    return cachePath;
}
async function resolveSpecifier(specifier, baseUrl, options) {
    if (isExternalScheme(specifier) || isInternalBare(specifier))
        return null;
    // For Deno: Keep npm: specifiers as-is (Deno resolves them natively with auto-dedup)
    // For other runtimes: Convert to esm.sh and cache locally
    if (specifier.startsWith("npm:")) {
        if (isDeno) {
            return specifier; // Let Deno's native npm resolution handle it
        }
        const cached = await cacheHttpModule(toEsmShUrlFromNpm(specifier), options);
        return cached ? `file://${cached}` : null;
    }
    if (isHttpUrl(specifier)) {
        const cached = await cacheHttpModule(specifier, options);
        return cached ? `file://${cached}` : null;
    }
    if (isRelative(specifier)) {
        if (!baseUrl || !isHttpUrl(baseUrl))
            return null;
        const resolved = new URL(specifier, baseUrl).toString();
        const cached = await cacheHttpModule(resolved, options);
        return cached ? `file://${cached}` : null;
    }
    const mapped = resolveBareSpecifier(specifier, options.importMap, options.reactVersion);
    if (mapped === specifier)
        return null;
    return resolveSpecifier(mapped, baseUrl, options);
}
async function buildReplacements(code, baseUrl, options) {
    const imports = await parseImports(code);
    const uniqueSpecifiers = [...new Set(imports.filter((imp) => imp.n).map((imp) => imp.n))];
    const results = await Promise.all(uniqueSpecifiers.map(async (specifier) => ({
        specifier,
        resolved: await resolveSpecifier(specifier, baseUrl, options),
    })));
    const replacements = new Map();
    for (const { specifier, resolved } of results) {
        if (resolved && resolved !== specifier)
            replacements.set(specifier, resolved);
    }
    return replacements;
}
async function rewriteModuleImports(code, moduleUrl, options) {
    const replacements = await buildReplacements(code, moduleUrl, options);
    if (replacements.size === 0)
        return code;
    return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
/**
 * Rewrite HTTP imports in the provided code to cached local file:// paths.
 */
export async function cacheHttpImportsToLocal(code, options) {
    const replacements = await buildReplacements(code, undefined, options);
    if (replacements.size === 0)
        return code;
    logger.debug("[HTTP-CACHE] Cached HTTP imports", { count: replacements.size });
    return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
/**
 * Cache a specific HTTP module URL and return its local file:// path.
 * Used by server-loader.ts to cache react-dom/server and ensure the same
 * React instance is used by both components and the SSR renderer.
 *
 * @param url - The HTTP URL to cache (e.g., https://esm.sh/react-dom@18.3.1/server)
 * @param cacheDir - The cache directory path
 * @returns The local file:// URL path, or the original URL if caching fails
 */
export async function cacheModuleToLocal(url, cacheDir) {
    if (!isHttpUrl(url))
        return url;
    const importMap = { imports: {}, scopes: {} };
    const cached = await cacheHttpModule(url, { cacheDir, importMap });
    return cached ? `file://${cached}` : url;
}
/**
 * Recover a missing HTTP bundle by looking up the code directly from the hash.
 * Used for cross-pod recovery when a file:// path points to a bundle that
 * exists in distributed cache but not on the local filesystem.
 *
 * Recovery strategy (in order of preference):
 * 1. Direct code lookup by hash (code:{hash}) - fastest, most reliable
 * 2. URL lookup then re-fetch (hash:{hash} → URL → fetch) - fallback
 *
 * @param hash - The hash from the bundle filename (e.g., "974671618" from "http-974671618.mjs")
 * @param cacheDir - The cache directory path
 * @returns true if recovery succeeded, false otherwise
 */
export async function recoverHttpBundleByHash(hash, cacheDir) {
    const distributed = await getDistributedCache();
    if (!distributed) {
        logger.debug("[HTTP-CACHE] No distributed cache for recovery");
        return false;
    }
    const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
    const cachePath = join(absoluteCacheDir, `http-${hash}.mjs`);
    const fs = createFileSystem();
    try {
        // Strategy 1: Direct code lookup by hash (preferred - no URL needed)
        const cachedCode = await distributed.get(`code:${hash}`);
        if (cachedCode) {
            logger.info("[HTTP-CACHE] Recovering bundle via direct code lookup", { hash });
            await fs.mkdir(absoluteCacheDir, { recursive: true });
            await fs.writeTextFile(cachePath, cachedCode);
            logger.info("[HTTP-CACHE] Bundle recovery successful (direct)", { hash, path: cachePath });
            // Proactively recover transitive deps so the import retry doesn't
            // fail again with a different missing bundle.
            const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
            const transitiveDeps = [];
            let m;
            while ((m = BUNDLE_RE.exec(cachedCode)) !== null) {
                const tHash = m[2];
                if (tHash !== hash) {
                    transitiveDeps.push({
                        path: join(absoluteCacheDir, `http-${tHash}.mjs`),
                        hash: tHash,
                    });
                }
            }
            if (transitiveDeps.length > 0) {
                logger.info("[HTTP-CACHE] Recovering transitive deps from last-resort recovery", {
                    count: transitiveDeps.length,
                });
                await ensureHttpBundlesExist(transitiveDeps, cacheDir);
            }
            return true;
        }
        // Strategy 2: URL lookup then re-fetch (fallback for bundles cached before code:{hash} was added)
        const originalUrl = await distributed.get(`hash:${hash}`);
        if (originalUrl) {
            logger.info("[HTTP-CACHE] Recovering bundle via URL re-fetch", { hash, originalUrl });
            const importMap = { imports: {}, scopes: {} };
            const result = await cacheHttpModule(originalUrl, { cacheDir, importMap });
            if (result) {
                logger.info("[HTTP-CACHE] Bundle recovery successful (re-fetch)", { hash, path: result });
                return true;
            }
        }
        logger.debug("[HTTP-CACHE] No recovery data found for hash", { hash });
        return false;
    }
    catch (error) {
        logger.error("[HTTP-CACHE] Bundle recovery failed", { hash, error });
        return false;
    }
}
/**
 * Ensure all HTTP bundles exist locally before import.
 * Proactively fetches missing bundles from distributed cache.
 *
 * This is the preferred approach over fail-then-recover:
 * - Check first, don't wait for import to fail
 * - Batch fetch for efficiency
 * - Clear error messages if bundles not available
 *
 * @param bundlePaths - Array of {path, hash} for bundles to check
 * @param cacheDir - Cache directory for HTTP bundles
 * @returns Array of hashes that could not be recovered
 */
export async function ensureHttpBundlesExist(bundlePaths, cacheDir) {
    if (bundlePaths.length === 0)
        return [];
    const fs = createFileSystem();
    const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
    // Use [a-f0-9]+ to match both hex and decimal hashes consistently
    const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
    const extractBundleRefs = (code) => {
        const refs = [];
        const dedup = new Set();
        let match;
        while ((match = BUNDLE_RE.exec(code)) !== null) {
            const hash = match[2];
            if (!dedup.has(hash)) {
                dedup.add(hash);
                refs.push({ hash });
            }
        }
        BUNDLE_RE.lastIndex = 0;
        return refs;
    };
    const pending = bundlePaths.map((b) => ({ hash: b.hash }));
    const seen = new Set();
    const failed = new Set();
    while (pending.length > 0) {
        const batch = pending.splice(0, pending.length).filter((b) => !seen.has(b.hash));
        if (batch.length === 0)
            break;
        for (const item of batch) {
            seen.add(item.hash);
        }
        // Check which bundles exist locally using canonical paths derived from
        // cacheDir + hash. Don't trust caller-provided paths — they may reference
        // a different pod's absolute directory.
        const existenceChecks = await Promise.all(batch.map(async ({ hash }) => ({
            hash,
            canonicalPath: join(absoluteCacheDir, `http-${hash}.mjs`),
            exists: await exists(join(absoluteCacheDir, `http-${hash}.mjs`)),
        })));
        const missing = existenceChecks.filter((b) => !b.exists);
        if (missing.length === 0)
            continue;
        logger.info("[HTTP-CACHE] Fetching missing bundles from distributed cache", {
            missing: missing.length,
            total: batch.length,
        });
        const distributed = await getDistributedCache();
        if (!distributed) {
            logger.error("[HTTP-CACHE] No distributed cache available for bundle recovery");
            for (const m of missing)
                failed.add(m.hash);
            continue;
        }
        // Batch fetch from distributed cache
        const codeKeys = missing.map((m) => `code:${m.hash}`);
        let codes;
        try {
            if (distributed.getBatch) {
                codes = await distributed.getBatch(codeKeys);
            }
            else {
                const results = await Promise.all(codeKeys.map(async (key) => [key, await distributed.get(key)]));
                codes = new Map(results);
            }
        }
        catch (error) {
            logger.error("[HTTP-CACHE] Batch fetch from distributed cache failed", { error });
            for (const m of missing)
                failed.add(m.hash);
            continue;
        }
        // Write fetched bundles to disk using canonical paths and scan for transitive deps
        await Promise.all(missing.map(async ({ hash, canonicalPath }) => {
            const code = codes.get(`code:${hash}`);
            if (!code) {
                // Try single-bundle recovery as last resort
                const recovered = await recoverHttpBundleByHash(hash, absoluteCacheDir);
                if (!recovered) {
                    failed.add(hash);
                }
                else {
                    // Read the recovered bundle to scan for transitive deps
                    try {
                        const recoveredCode = await fs.readTextFile(canonicalPath);
                        for (const ref of extractBundleRefs(recoveredCode)) {
                            if (!seen.has(ref.hash))
                                pending.push(ref);
                        }
                    }
                    catch { /* ignore read errors for dep scanning */ }
                }
                return;
            }
            try {
                await fs.mkdir(absoluteCacheDir, { recursive: true });
                await fs.writeTextFile(canonicalPath, code);
                logger.debug("[HTTP-CACHE] Wrote bundle to disk", { hash, path: canonicalPath });
                // Scan recovered code for transitive HTTP bundle dependencies.
                // HTTP bundles import other bundles (e.g., esm.sh packages depending
                // on other packages). Without this, Pod B recovers only the top-level
                // bundle and gets "Module not found" for transitive deps at import time.
                for (const ref of extractBundleRefs(code)) {
                    if (!seen.has(ref.hash))
                        pending.push(ref);
                }
            }
            catch (error) {
                logger.error("[HTTP-CACHE] Failed to write bundle to disk", { hash, error });
                failed.add(hash);
            }
        }));
    }
    if (failed.size > 0) {
        logger.warn("[HTTP-CACHE] Some bundles could not be recovered", {
            failed: Array.from(failed),
        });
    }
    return Array.from(failed);
}
