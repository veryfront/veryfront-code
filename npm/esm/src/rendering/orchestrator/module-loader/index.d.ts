/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export { createEsmCache, createModuleCache, generateHash } from "./cache.js";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.js";
export interface ModuleLoaderConfig {
    projectDir: string;
    projectId?: string;
    adapter: RuntimeAdapter;
    mode: "development" | "production";
    moduleCache: Map<string, string>;
    esmCache: Map<string, string>;
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
export declare function transformModuleWithDeps(filePath: string, tmpDir: string, localAdapter: RuntimeAdapter, config: ModuleLoaderConfig, useLocalAdapter?: boolean): Promise<string>;
/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export declare function loadModule(filePath: string, config: ModuleLoaderConfig): Promise<any>;
//# sourceMappingURL=index.d.ts.map