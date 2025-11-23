/**
 * Bundler module - Unified exports for code splitting and bundling
 *
 * Provides barrel exports to simplify deep import paths within the build system.
 * Instead of importing from `./bundler/code-splitter/index.ts`, use `./bundler/index.ts`
 *
 * @module build/bundler
 */

// Code Splitter exports
export type {
  ChunkInfo,
  ChunkManifest,
  MetafileOutput,
  RouteChunkInfo,
  SplitOptions,
  SplitResult,
} from "./code-splitter/types.ts";

export { CodeSplitter, createCodeSplitter } from "./code-splitter/index.ts";
export {
  buildManifest,
  calculateFileHash,
  convertPathToName,
  createBuildContext,
  createEntryPoints,
  createShimFile,
  createSplitterPlugin,
  extractChunkName,
  extractEntryName,
  generatePreloadLinks,
  getChunkInfo,
  getChunksForRoute,
  getExternalDependencies,
  getPreloadHints,
  isCriticalImport,
  loadChunkManifest,
  writeManifest,
} from "./code-splitter/index.ts";

// Re-export the code-splitter barrel for backward compatibility
export * from "./code-splitter/index.ts";
