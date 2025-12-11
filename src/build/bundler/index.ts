
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

export * from "./code-splitter/index.ts";
