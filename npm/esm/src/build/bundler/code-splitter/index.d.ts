/**
 * Code splitter public API
 * @module code-splitter
 */
export type { ChunkInfo, ChunkManifest, MetafileOutput, RouteChunkInfo, SplitOptions, SplitResult, } from "./types.js";
export { CodeSplitter } from "./splitter.js";
export { convertPathToName, createEntryPoints } from "./entry-points.js";
export { buildManifest, calculateFileHash, extractChunkName, extractEntryName, getChunkInfo, getPreloadHints, isCriticalImport, writeManifest, } from "./manifest-builder.js";
export { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.js";
export { createSplitterPlugin } from "./esbuild-plugin.js";
import type { ChunkManifest, SplitOptions } from "./types.js";
import { CodeSplitter } from "./splitter.js";
export declare function createCodeSplitter(options: SplitOptions): CodeSplitter;
export declare function loadChunkManifest(manifestPath: string): Promise<ChunkManifest>;
export declare function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[];
export declare function generatePreloadLinks(manifest: ChunkManifest, routePath: string, baseUrl?: string): string;
//# sourceMappingURL=index.d.ts.map