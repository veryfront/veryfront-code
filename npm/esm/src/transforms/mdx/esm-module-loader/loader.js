/**
 * ESM Module Loader
 *
 * Main coordinator for loading MDX modules as ESM.
 * Handles import transformation, caching, and module execution.
 *
 * @module build/transforms/mdx/esm-module-loader/loader
 */
import { join } from "../../../../deps/deno.land/std@0.220.0/path/mod.js";
import { rendererLogger as logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "../../../utils/cache-dir.js";
import { Singleflight } from "../../../utils/singleflight.js";
import { loadImportMap, transformImportsWithMap } from "../../../modules/import-map/index.js";
import { cacheHttpImportsToLocal, ensureHttpBundlesExist } from "../../esm/http-cache.js";
import { TRANSFORM_CACHE_VERSION } from "../../esm/package-registry.js";
import { isDeno } from "../../../platform/compat/runtime.js";
import { replaceSpecifiers } from "../../esm/lexer.js";
import { setupSSRGlobals } from "../../../rendering/ssr-globals.js";
import { getLocalReactPaths, isReactSpecifier } from "../../../platform/compat/react-paths.js";
import { ESBUILD_JSX_FACTORY, ESBUILD_JSX_FRAGMENT, FRAMEWORK_ROOT, JSX_IMPORT_PATTERN, LOG_PREFIX_MDX_LOADER, LOG_PREFIX_MDX_RENDERER, REACT_IMPORT_PATTERN, UNRESOLVED_VF_MODULES_PATTERN, } from "./constants.js";
import { getLocalFs } from "./cache/index.js";
import { hashString } from "./utils/hash.js";
import { createStubModule } from "./utils/stub-module.js";
import { createModuleFetcherContext, fetchAndCacheModule } from "./module-fetcher/index.js";
/** Singleflight for MDX module file writes to prevent race conditions */
const mdxWriteFlight = new Singleflight();
function resolveProjectDir(context) {
    if (context.projectDir)
        return context.projectDir;
    const envProjectDir = context.adapter?.env.get("VERYFRONT_PROJECT_DIR") ??
        context.adapter?.env.get("VF_PROJECT_DIR");
    if (envProjectDir)
        return envProjectDir;
    throw new Error("[MDX] projectDir is required for import map resolution. Pass it explicitly to loadModuleESM.");
}
/**
 * Initialize the ESM cache directory.
 * Includes contentSourceId in the path to isolate preview vs production caches.
 */
async function initializeCacheDir(context) {
    if (context.esmCacheDir)
        return context.esmCacheDir;
    if (!context.projectId) {
        throw new Error(`Missing projectId for MDX ESM cache directory (projectSlug: ${context.projectSlug})`);
    }
    if (!context.contentSourceId) {
        throw new Error(`Missing contentSourceId for MDX ESM cache directory (project: ${context.projectId})`);
    }
    const localFs = getLocalFs();
    const baseCacheDir = getMdxEsmCacheDir();
    // Use projectId consistently for stable cache keys (won't change if slug is renamed)
    const projectKey = encodeURIComponent(context.projectId);
    const sourceKey = encodeURIComponent(context.contentSourceId);
    const persistentCacheDir = join(baseCacheDir, projectKey, sourceKey);
    try {
        await localFs.mkdir(persistentCacheDir, { recursive: true });
        context.esmCacheDir = persistentCacheDir;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Using persistent cache dir: ${persistentCacheDir}`);
        return persistentCacheDir;
    }
    catch {
        const tempDir = await localFs.makeTempDir({ prefix: `veryfront-mdx-esm-${projectKey}-` });
        context.esmCacheDir = tempDir;
        return tempDir;
    }
}
/**
 * Rewrite @/ aliased imports to /_vf_modules/ paths.
 */
function rewriteProjectAliasImports(code) {
    return code.replace(/from\s+["']@\/([^"']+)["']/g, (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        return `from "/_vf_modules/${jsPath}"`;
    });
}
/**
 * Transform bare React specifiers to local file:// paths for Bun/Node.
 * This ensures the same React instance as react-dom-server.
 * For Deno, getLocalReactPaths() returns an empty object, so this is a no-op.
 */
async function transformReactToLocalPaths(code) {
    const localPaths = getLocalReactPaths();
    if (Object.keys(localPaths).length === 0)
        return code;
    return await replaceSpecifiers(code, (specifier) => localPaths[specifier] || null);
}
function stripReactFromImportMap(importMap) {
    const imports = importMap.imports ? { ...importMap.imports } : undefined;
    if (imports) {
        for (const key of Object.keys(imports)) {
            if (isReactSpecifier(key))
                delete imports[key];
        }
    }
    const scopes = importMap.scopes
        ? Object.fromEntries(Object.entries(importMap.scopes).map(([scope, mappings]) => {
            const filtered = { ...mappings };
            for (const key of Object.keys(filtered)) {
                if (isReactSpecifier(key))
                    delete filtered[key];
            }
            return [scope, filtered];
        }))
        : undefined;
    return { imports, scopes };
}
/**
 * Transform imports using project import maps.
 * React is intentionally left as a bare specifier for SSR consistency.
 */
function transformImports(code, importMap) {
    return transformImportsWithMap(code, stripReactFromImportMap(importMap), undefined, {
        resolveBare: true,
    });
}
/**
 * Find /_vf_modules/ imports in code.
 */
function findVfModuleImports(code) {
    const imports = [];
    const pattern = /from\s+["'](\/?)(_vf_modules\/[^"']+)["']/g;
    let match;
    while ((match = pattern.exec(code)) !== null) {
        const [original, , path] = match;
        if (path)
            imports.push({ original, path });
    }
    return imports;
}
/**
 * Process /_vf_modules/ imports and replace them with file:// paths.
 */
async function processVfModuleImports(code, imports, context, projectDir) {
    const projectSlug = context.projectSlug || "unknown";
    const adapter = context.adapter;
    if (!adapter) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} No adapter available for module fetching`);
        return code;
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} processVfModuleImports: found imports`, {
        projectSlug,
        count: imports.length,
        paths: imports.map((i) => i.path).slice(0, 10),
    });
    if (imports.length === 0) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} processVfModuleImports: no imports to process`, {
            projectSlug,
        });
        return code;
    }
    if (!context.projectId) {
        throw new Error(`Missing projectId for module fetching (projectSlug: ${context.projectSlug})`);
    }
    const fetcherContext = createModuleFetcherContext(context.esmCacheDir, adapter, projectDir, context.projectId, { reactVersion: context.reactVersion });
    const fetchStart = performance.now();
    const results = await Promise.all(imports.map(async ({ original, path }, index) => {
        return await withSpan(SpanNames.MDX_FETCH_MODULE, async () => {
            const moduleStart = performance.now();
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module START`, {
                projectSlug,
                index,
                path,
            });
            const filePath = await fetchAndCacheModule(path, fetcherContext);
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module DONE`, {
                projectSlug,
                index,
                path,
                durationMs: (performance.now() - moduleStart).toFixed(1),
            });
            return { original, filePath, path };
        }, {
            "mdx.module_path": path,
            "mdx.module_index": index,
            "mdx.project_slug": projectSlug,
        });
    }));
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
        projectSlug,
        moduleCount: imports.length,
        durationMs: (performance.now() - fetchStart).toFixed(1),
    });
    let result = code;
    for (const { original, filePath, path } of results) {
        if (filePath) {
            result = result.replace(original, `from "file://${filePath}"`);
            continue;
        }
        const stubPath = await createStubModule(path, result, original, context.esmCacheDir);
        if (stubPath)
            result = result.replace(original, `from "file://${stubPath}"`);
    }
    return result;
}
/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
async function transformJsxImports(code, adapter, esmCacheDir) {
    const { transform } = await import("esbuild");
    const importsToProcess = [];
    let jsxMatch;
    while ((jsxMatch = JSX_IMPORT_PATTERN.exec(code)) !== null) {
        const [fullMatch, importClause, filePath, ext] = jsxMatch;
        if (!filePath || !importClause || !ext) {
            logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined fields`, {
                fullMatch,
                hasFilePath: !!filePath,
                hasImportClause: !!importClause,
                hasExt: !!ext,
            });
            continue;
        }
        importsToProcess.push({ fullMatch, importClause, filePath, ext });
    }
    if (importsToProcess.length === 0)
        return code;
    const transformStart = performance.now();
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`);
    const transformResults = await Promise.all(importsToProcess.map(async ({ fullMatch, importClause, filePath, ext }) => {
        try {
            const transformedFileName = `jsx-v${TRANSFORM_CACHE_VERSION}-${hashString(filePath)}.mjs`;
            const transformedPath = join(esmCacheDir, transformedFileName);
            try {
                const stat = await getLocalFs().stat(transformedPath);
                if (stat?.isFile) {
                    return {
                        original: fullMatch,
                        transformed: `import ${importClause} from "file://${transformedPath}";`,
                        cached: true,
                    };
                }
            }
            catch {
                // Not cached
            }
            const isFrameworkFile = filePath.startsWith(FRAMEWORK_ROOT);
            const jsxCode = isFrameworkFile
                ? await getLocalFs().readTextFile(filePath)
                : await adapter.fs.readFile(filePath);
            const loaderMap = {
                tsx: "tsx",
                ts: "ts",
                jsx: "jsx",
                js: "js",
            };
            const loader = loaderMap[ext] ?? "tsx";
            const result = await transform(jsxCode, {
                loader,
                jsx: "transform",
                jsxFactory: ESBUILD_JSX_FACTORY,
                jsxFragment: ESBUILD_JSX_FRAGMENT,
                format: "esm",
            });
            let transformed = result.code;
            if (!REACT_IMPORT_PATTERN.test(transformed)) {
                transformed = `import React from 'react';\n${transformed}`;
            }
            await getLocalFs().writeTextFile(transformedPath, transformed);
            return {
                original: fullMatch,
                transformed: `import ${importClause} from "file://${transformedPath}";`,
                cached: false,
            };
        }
        catch (error) {
            logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
            return null;
        }
    }));
    logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
        total: importsToProcess.length,
        success: transformResults.filter(Boolean).length,
        cached: transformResults.filter((r) => r?.cached).length,
        durationMs: (performance.now() - transformStart).toFixed(1),
    });
    let result = code;
    for (const t of transformResults) {
        if (t)
            result = result.replace(t.original, t.transformed);
    }
    return result;
}
/**
 * Cache HTTP imports to local file:// paths for Node/Bun SSR.
 * Deno supports HTTP imports natively, so we skip this step to avoid
 * creating pod-specific file:// paths that break distributed caching.
 */
async function cacheHttpImports(code, importMap) {
    if (isDeno)
        return code;
    return await cacheHttpImportsToLocal(code, { cacheDir: getHttpBundleCacheDir(), importMap });
}
/** Pattern to extract HTTP bundle paths from code */
const HTTP_BUNDLE_PATTERN = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
/**
 * Extract all HTTP bundle paths and hashes from code.
 * Returns array of {path, hash} for proactive bundle checking.
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
export async function loadModuleESM(compiledProgramCode, context) {
    const projectSlug = context.projectSlug || "unknown";
    return await withSpan(SpanNames.MDX_LOAD_MODULE_ESM, () => doLoadModuleESM(compiledProgramCode, context), {
        "mdx.project_slug": projectSlug,
        "mdx.code_length": compiledProgramCode.length,
    });
}
async function doLoadModuleESM(compiledProgramCode, context) {
    const loadStart = performance.now();
    const projectSlug = context.projectSlug || "unknown";
    logger.debug(`${LOG_PREFIX_MDX_LOADER} loadModuleESM START`, { projectSlug });
    try {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: Detect adapter START`, { projectSlug });
        if (!context.adapter) {
            const { runtime } = await import("../../../platform/adapters/detect.js");
            context.adapter = await runtime.get();
        }
        const adapter = context.adapter;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: Detect adapter DONE`, { projectSlug });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: initializeCacheDir START`, { projectSlug });
        const esmCacheDir = await initializeCacheDir(context);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: initializeCacheDir DONE`, { projectSlug });
        let rewritten = rewriteProjectAliasImports(compiledProgramCode);
        const projectDir = resolveProjectDir(context);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: loadImportMap START`, { projectSlug });
        const importMap = await loadImportMap(projectDir, adapter);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: loadImportMap DONE`, { projectSlug });
        rewritten = transformImports(rewritten, importMap);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: processVfModuleImports START`, { projectSlug });
        const vfModuleImports = findVfModuleImports(rewritten);
        rewritten = await withSpan(SpanNames.MDX_PROCESS_VF_MODULES, () => processVfModuleImports(rewritten, vfModuleImports, context, projectDir), { "mdx.vf_module_count": vfModuleImports.length });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: processVfModuleImports DONE`, { projectSlug });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformJsxImports START`, { projectSlug });
        rewritten = await withSpan(SpanNames.MDX_TRANSFORM_JSX, () => transformJsxImports(rewritten, adapter, esmCacheDir), { "mdx.project_slug": projectSlug });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformJsxImports DONE`, { projectSlug });
        if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
            rewritten += "\nexport { MDXLayout as __vfLayout };\n";
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: cacheHttpImports START`, { projectSlug });
        rewritten = await withSpan(SpanNames.MDX_CACHE_HTTP, () => cacheHttpImports(rewritten, importMap), { "mdx.project_slug": projectSlug });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: cacheHttpImports DONE`, { projectSlug });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformReactToLocalPaths START`, {
            projectSlug,
        });
        rewritten = await transformReactToLocalPaths(rewritten);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformReactToLocalPaths DONE`, { projectSlug });
        const codeHash = hashString(rewritten);
        if (!context.projectId) {
            throw new Error(`Missing projectId for MDX module cache (projectSlug: ${context.projectSlug})`);
        }
        const namespace = context.projectId;
        const namespaceKey = encodeURIComponent(namespace);
        const compositeKey = `${namespaceKey}:${codeHash}`;
        const cached = context.moduleCache.get(compositeKey);
        if (cached) {
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Module cache hit`, { projectSlug, compositeKey });
            return cached;
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Module cache miss`, { projectSlug, compositeKey });
        const unresolvedMatches = [
            ...rewritten.matchAll(new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g")),
        ];
        if (unresolvedMatches.length > 0) {
            const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 5);
            const errorMsg = `MDX has ${unresolvedMatches.length} unresolved module imports: ${unresolvedPaths.join(", ")}`;
            logger.error(`${LOG_PREFIX_MDX_RENDERER} ${errorMsg}`);
            throw new Error(errorMsg);
        }
        const nsDir = join(esmCacheDir, namespaceKey);
        const localFs = getLocalFs();
        try {
            await localFs.mkdir(nsDir, { recursive: true });
        }
        catch (e) {
            logger.debug(`${LOG_PREFIX_MDX_RENDERER} mkdir nsDir failed`, e instanceof Error ? e : String(e));
        }
        const filePath = join(nsDir, `${codeHash}.mjs`);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: mdxWriteFlight START`, { projectSlug, filePath });
        await mdxWriteFlight.do(filePath, async () => {
            try {
                const stat = await localFs.stat(filePath);
                if (stat?.isFile) {
                    logger.debug(`${LOG_PREFIX_MDX_LOADER} File exists, skipping write`, {
                        projectSlug,
                        filePath,
                    });
                    return;
                }
            }
            catch {
                // File doesn't exist
            }
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Writing module file`, { projectSlug, filePath });
            await localFs.writeTextFile(filePath, rewritten);
        });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: mdxWriteFlight DONE`, { projectSlug, filePath });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: dynamic import START`, {
            projectSlug,
            filePath,
            codePreview: rewritten.substring(0, 200),
        });
        setupSSRGlobals();
        // Proactively ensure all HTTP bundles exist before import
        // This is more reliable than fail-then-recover: check first, don't wait for import to fail
        const bundlePaths = extractHttpBundlePaths(rewritten);
        if (bundlePaths.length > 0) {
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Checking HTTP bundles`, {
                count: bundlePaths.length,
                projectSlug,
            });
            const cacheDir = getHttpBundleCacheDir();
            const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
            if (failed.length > 0) {
                throw new Error(`Failed to recover ${failed.length} HTTP bundle(s) from distributed cache: ${failed.join(", ")}`);
            }
        }
        const mod = await withSpan(SpanNames.MDX_DYNAMIC_IMPORT, () => import(`file://${filePath}?v=${codeHash}`), { "mdx.file_path": filePath.split("/").pop() || filePath });
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: dynamic import DONE`, {
            projectSlug,
            exports: Object.keys(mod),
        });
        const result = {
            ...mod,
            default: mod?.default,
            MDXContent: mod?.MDXContent,
            frontmatter: mod?.frontmatter,
            headings: mod?.headings,
            title: mod?.title,
            description: mod?.description,
            layout: mod?.layout,
            MDXLayout: (mod?.MDXLayout || mod?.__vfLayout),
            MainLayout: mod?.MainLayout,
        };
        context.moduleCache.set(compositeKey, result);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} loadModuleESM completed`, {
            durationMs: (performance.now() - loadStart).toFixed(1),
        });
        return result;
    }
    catch (error) {
        logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);
        throw error;
    }
}
