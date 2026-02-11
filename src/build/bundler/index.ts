/**
 * Bundler module - Unified exports for code splitting and bundling
 * @module build/bundler
 */

export type {
  ChunkInfo,
  ChunkManifest,
  MetafileOutput,
  RouteChunkInfo,
  SplitOptions,
  SplitResult,
} from "./code-splitter/index.ts";

export { CodeSplitter } from "./code-splitter/index.ts";

export { convertPathToName, createEntryPoints } from "./code-splitter/index.ts";
export {
  buildManifest,
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getChunkInfo,
  getPreloadHints,
  isCriticalImport,
  writeManifest,
} from "./code-splitter/index.ts";
export {
  createBuildContext,
  createShimFile,
  getExternalDependencies,
} from "./code-splitter/index.ts";
export { createSplitterPlugin } from "./code-splitter/index.ts";
export {
  createCodeSplitter,
  generatePreloadLinks,
  getChunksForRoute,
  loadChunkManifest,
} from "./code-splitter/index.ts";
