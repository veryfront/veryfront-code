/**
 * ESM Module Loader
 *
 * Main coordinator for loading MDX modules as ESM.
 * Handles import transformation, caching, and module execution.
 *
 * @module build/transforms/mdx/esm-module-loader/loader
 */
import type { MDXModule } from "../types.js";
import type { ESMLoaderContext } from "./types.js";
export declare function loadModuleESM(compiledProgramCode: string, context: ESMLoaderContext): Promise<MDXModule>;
//# sourceMappingURL=loader.d.ts.map