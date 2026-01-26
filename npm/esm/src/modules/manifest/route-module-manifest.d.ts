/**
 * Route Module Manifest
 *
 * Tracks and caches module dependencies per route to enable:
 * - Expanded modulepreload hints (all dependencies, not just page/layout)
 * - Module batch endpoint (coalesce multiple requests)
 * - Background bundle generation
 * - 103 Early Hints with predictive preloading
 *
 * @module module-system/manifest/route-module-manifest
 */
/**
 * Single module entry with metadata
 */
interface ModuleEntry {
    /** Module path (e.g., "pages/index.js") */
    path: string;
    /** Whether this is a critical path module (page/layout) */
    critical: boolean;
    /** Load order (lower = loaded earlier) */
    loadOrder: number;
    /** Size in bytes (if known) */
    sizeBytes?: number;
}
/**
 * Complete manifest for a single route
 */
interface RouteManifest {
    /** Route slug (e.g., "", "about", "blog/[slug]") */
    route: string;
    /** All modules needed for this route */
    modules: ModuleEntry[];
    /** Total count of modules */
    moduleCount: number;
    /** Total size in bytes (if all sizes known) */
    totalSizeBytes?: number;
    /** When this manifest was last updated */
    updatedAt: number;
    /** How many times this route has been rendered */
    renderCount: number;
}
export declare function startModuleCollection(requestId: string): void;
export declare function recordModuleLoad(requestId: string, modulePath: string, _critical?: boolean): void;
export declare function finishModuleCollection(requestId: string, projectSlug: string | undefined, route: string, criticalModules?: string[]): void;
export declare function getRouteManifest(projectSlug: string | undefined, route: string): RouteManifest | null;
export declare function getRouteModulePaths(projectSlug: string | undefined, route: string): string[];
export declare function getCriticalModulePaths(projectSlug: string | undefined, route: string): string[];
export declare function recordSSRModules(projectSlug: string | undefined, route: string, modules: string[]): void;
export declare function generateModulePreloadHintsFromManifest(projectSlug: string | undefined, route: string, maxHints?: number): string[];
export declare function getManifestStats(): {
    routeCount: number;
    totalModules: number;
    routes: Array<{
        route: string;
        moduleCount: number;
        renderCount: number;
    }>;
};
export declare function clearProjectManifests(projectSlug: string): void;
export declare function clearAllManifests(): void;
export {};
//# sourceMappingURL=route-module-manifest.d.ts.map