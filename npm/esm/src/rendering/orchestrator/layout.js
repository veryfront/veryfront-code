import { LayoutApplicator } from "../layouts/index.js";
import { createDefaultMDXComponents } from "../utils/index.js";
import { loadTSXComponent, preloadMDXLayoutModule } from "../layouts/utils/component-loader.js";
import { clearImportMapCache, preloadImportMap } from "../../modules/import-map/index.js";
import { clearSSRModuleCacheForProject } from "../../modules/react-loader/index.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
export class LayoutOrchestrator {
    config;
    /** Preloaded import map for MDX layout application */
    _preloadedImportMap = null;
    constructor(config) {
        this.config = config;
    }
    /** Get preloaded import map if available */
    getPreloadedImportMap() {
        return this._preloadedImportMap;
    }
    clearCache() {
        this.config.layoutCache.clear();
        clearSSRModuleCacheForProject(this.config.projectId);
        clearImportMapCache(this.config.projectDir);
        this._preloadedImportMap = null;
    }
    collectLayouts(pageInfo) {
        return withSpan("layout.collectLayouts", async () => {
            const result = await this.config.layoutCollector.collectLayouts(pageInfo);
            await this.config.layoutCompiler.compileLayouts(result.nestedLayouts);
            return result;
        }, { "layout.pagePath": pageInfo.entity.path });
    }
    preloadLayoutModules(nestedLayouts) {
        return withSpan("layout.preloadModules", async () => {
            const tsxLayouts = nestedLayouts.filter((layout) => layout.kind === "tsx" && layout.componentPath);
            const mdxLayouts = nestedLayouts.filter((layout) => layout.kind === "mdx" && layout.bundle);
            const hasTsxLayouts = tsxLayouts.length > 0;
            const hasMdxLayouts = mdxLayouts.length > 0;
            if (!hasTsxLayouts && !hasMdxLayouts) {
                return;
            }
            const preloadStart = performance.now();
            logger.debug("[LayoutOrchestrator] Preloading layout modules", {
                tsxCount: tsxLayouts.length,
                mdxCount: mdxLayouts.length,
                tsxPaths: tsxLayouts.map((l) => l.componentPath),
            });
            // Build array of preload promises
            const preloadPromises = [];
            // 1. Preload import map (needed for MDX layouts)
            if (hasMdxLayouts) {
                preloadPromises.push(preloadImportMap(this.config.projectDir, this.config.adapter)
                    .then((importMap) => {
                    this._preloadedImportMap = importMap;
                    return { type: "importMap", success: true };
                })
                    .catch((error) => {
                    logger.warn("[LayoutOrchestrator] Failed to preload import map", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this._preloadedImportMap = null;
                    return { type: "importMap", success: false };
                }));
            }
            // 2. Preload TSX layouts
            for (const layout of tsxLayouts) {
                const componentPath = layout.componentPath;
                preloadPromises.push(loadTSXComponent(componentPath, this.config.projectDir, this.config.layoutCache, this.config.adapter, this.config.projectId, this.config.projectSlug, this.config.contentSourceId)
                    .then(() => ({ type: "tsx", path: componentPath, success: true }))
                    .catch((error) => {
                    logger.warn("[LayoutOrchestrator] Failed to preload TSX layout (will retry during apply)", {
                        path: componentPath,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return { type: "tsx", path: componentPath, success: false };
                }));
            }
            // 3. Preload MDX layout modules (after import map)
            for (const layout of mdxLayouts) {
                preloadPromises.push(preloadMDXLayoutModule(layout.bundle, this.config.projectDir, this.config.adapter, this.config.projectId, this.config.projectSlug, this.config.contentSourceId)
                    .then(() => ({ type: "mdx", path: layout.path, success: true }))
                    .catch((error) => {
                    logger.warn("[LayoutOrchestrator] Failed to preload MDX layout (will retry during apply)", {
                        path: layout.path,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return { type: "mdx", path: layout.path, success: false };
                }));
            }
            // Run all preloads in parallel
            const results = await Promise.all(preloadPromises);
            const tsxResults = results.filter((r) => r.type === "tsx");
            const mdxResults = results.filter((r) => r.type === "mdx");
            const importMapResult = results.find((r) => r.type === "importMap");
            logger.debug("[LayoutOrchestrator] Preload complete", {
                tsxTotal: tsxResults.length,
                tsxSuccess: tsxResults.filter((r) => r.success).length,
                mdxTotal: mdxResults.length,
                mdxSuccess: mdxResults.filter((r) => r.success).length,
                importMapSuccess: importMapResult?.success ?? "n/a",
                duration: `${(performance.now() - preloadStart).toFixed(2)}ms`,
            });
        }, {
            "layout.preloadCount": nestedLayouts.length,
            "layout.tsxCount": nestedLayouts.filter((l) => l.kind === "tsx").length,
            "layout.mdxCount": nestedLayouts.filter((l) => l.kind === "mdx").length,
        });
    }
    applyLayoutsAndWrappers(pageElement, pageInfo, layoutBundle, nestedLayouts, layoutDataMap, requestUrl, frontmatter, headings, projectSlug) {
        return withSpan("layout.applyLayoutsAndWrappers", async () => {
            const mergedComponents = {
                ...createDefaultMDXComponents(),
                ...this.config.componentRegistry,
            };
            const layoutApplicator = new LayoutApplicator({
                projectDir: this.config.projectDir,
                projectId: this.config.projectId,
                projectSlug: projectSlug ?? this.config.projectSlug,
                contentSourceId: this.config.contentSourceId,
                preloadedImportMap: this._preloadedImportMap,
                adapter: this.config.adapter,
                config: this.config.config,
                layoutCache: this.config.layoutCache,
                mergedComponents,
                mode: this.config.mode,
                moduleServerUrl: this.config.moduleServerUrl,
                requestUrl,
                frontmatter,
                headings,
            });
            const pageType = pageElement.type;
            logger.debug("[LayoutOrchestrator] Before applyLayouts", {
                pageElementType: typeof pageType === "function" ? pageType.name : typeof pageType,
            });
            const result = await layoutApplicator.applyLayouts(pageElement, pageInfo, layoutBundle, nestedLayouts, layoutDataMap);
            const resultType = result.type;
            logger.debug("[LayoutOrchestrator] After applyLayouts", {
                resultType: typeof resultType === "function" ? resultType.name : typeof resultType,
                isSameElement: result === pageElement,
            });
            return result;
        }, { "layout.pagePath": pageInfo.entity.path, "layout.nestedCount": nestedLayouts.length });
    }
}
