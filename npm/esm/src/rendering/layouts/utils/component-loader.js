import { computeHash, rendererLogger as logger, TSX_LAYOUT_MAX_ENTRIES } from "../../../utils/index.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
import { preloadImportMap, transformImportsWithMap } from "../../../modules/import-map/index.js";
import { mdxRenderer } from "../../../transforms/mdx/index.js";
import { loadComponentFromSource } from "../../../modules/react-loader/component-loader.js";
import { getProjectReact } from "../../../react/index.js";
import { ensureValidChild } from "./ensure-valid-child.js";
import { buildLayoutComponentCacheKey } from "../../../cache/keys.js";
class InMemoryLayoutComponentCache {
    maxEntries;
    entries = new Map();
    constructor(maxEntries = TSX_LAYOUT_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    get(key) {
        const value = this.entries.get(key);
        if (!value)
            return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.entries.has(key)) {
            this.entries.delete(key);
            this.entries.set(key, value);
            return;
        }
        if (this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey)
                this.entries.delete(oldestKey);
        }
        this.entries.set(key, value);
    }
    delete(key) {
        this.entries.delete(key);
    }
    clear() {
        this.entries.clear();
    }
}
export function createLayoutComponentCache(maxEntries = TSX_LAYOUT_MAX_ENTRIES) {
    return new InMemoryLayoutComponentCache(maxEntries);
}
export async function loadTSXComponent(componentPath, projectDir, cache, adapter, projectId, contentSourceId) {
    const source = await adapter.fs.readFile(componentPath);
    const hash = await computeHash(source);
    const cacheKey = buildLayoutComponentCacheKey(projectId, componentPath, hash, contentSourceId);
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const loaded = await loadComponentFromSource(source, componentPath, projectDir, adapter, {
        dev: true,
        projectId,
        ssr: true,
        contentSourceId,
    });
    if (!loaded) {
        throw toError(createError({
            type: "render",
            message: "Component loading failed",
        }));
    }
    cache.set(cacheKey, loaded);
    return loaded;
}
/** Load an MDX layout module from a bundle. */
export function loadMDXLayout(bundle, projectDir, adapter, projectId, projectSlug, contentSourceId, preloadedImportMap) {
    return withSpan(SpanNames.LAYOUT_LOAD_MDX, async () => {
        logger.debug("[loadMDXLayout] START", {
            projectSlug,
            hasPreloadedImportMap: !!preloadedImportMap,
        });
        // Use preloaded import map if available, otherwise load it
        let map;
        if (preloadedImportMap) {
            map = preloadedImportMap;
            logger.debug("[loadMDXLayout] Using preloaded import map", { projectSlug });
        }
        else {
            logger.debug("[loadMDXLayout] loadImportMap START", { projectSlug });
            map = await preloadImportMap(projectDir, adapter);
            logger.debug("[loadMDXLayout] loadImportMap DONE", { projectSlug });
        }
        const code = transformImportsWithMap(bundle.compiledCode, map);
        logger.debug("[loadMDXLayout] Loading module via loadModuleESM START", {
            projectSlug,
            codeLength: code.length,
        });
        const mod = (await mdxRenderer.loadModuleESM(code, adapter, projectId, projectDir, projectSlug, contentSourceId));
        logger.debug("[loadMDXLayout] loadModuleESM DONE", {
            projectSlug,
            exports: Object.keys(mod),
        });
        return mod.MDXLayout || mod.MainLayout || mod.default;
    }, {
        "layout.project_slug": projectSlug || "",
        "layout.has_preloaded_import_map": !!preloadedImportMap,
        "layout.code_length": bundle.compiledCode?.length || 0,
    });
}
/** Preload an MDX layout module into cache for faster subsequent loads. */
export async function preloadMDXLayoutModule(bundle, projectDir, adapter, projectId, projectSlug, contentSourceId) {
    // Just call loadMDXLayout - the module loader will cache the result
    await loadMDXLayout(bundle, projectDir, adapter, projectId, projectSlug, contentSourceId);
}
export async function applyTSXLayout(element, item, tsxLayoutModuleCache, projectDir, adapter, props, projectId, contentSourceId) {
    const start = performance.now();
    logger.debug("[applyTSXLayout] START", { componentPath: item.componentPath, projectId });
    const React = await getProjectReact();
    try {
        logger.debug("[applyTSXLayout] loadTSXComponent START", { componentPath: item.componentPath });
        const loadStart = performance.now();
        const LayoutComponent = await loadTSXComponent(item.componentPath, projectDir, tsxLayoutModuleCache, adapter, projectId, contentSourceId);
        logger.debug("[applyTSXLayout] loadTSXComponent DONE", {
            componentPath: item.componentPath,
            duration: `${(performance.now() - loadStart).toFixed(2)}ms`,
        });
        const result = React.createElement(LayoutComponent, props ?? {}, element);
        logger.debug("[applyTSXLayout] DONE", {
            componentPath: item.componentPath,
            totalDuration: `${(performance.now() - start).toFixed(2)}ms`,
        });
        return result;
    }
    catch (e) {
        logger.error("Failed to compile/import TSX layout", e);
        throw e;
    }
}
export async function applyMDXLayout(element, bundle, projectDir, mergedComponents, adapter, projectId, projectSlug, contentSourceId, preloadedImportMap) {
    const React = await getProjectReact();
    const LayoutFn = await loadMDXLayout(bundle, projectDir, adapter, projectId, projectSlug, contentSourceId, preloadedImportMap);
    if (!LayoutFn) {
        logger.debug("[applyMDXLayout] No layout function found");
        return element;
    }
    const child = ensureValidChild(element, React);
    return React.createElement(LayoutFn, { components: mergedComponents }, child);
}
