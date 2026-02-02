/**
 * Bundler Module
 *
 * Provides the infrastructure for the hybrid mode-specific renderer architecture:
 *
 * **Production Mode: JIT Bundle on First Request**
 * - Full project bundling with esbuild
 * - Bundle cached in veryfront-api for cross-pod sharing
 * - Content hash as cache key for automatic invalidation
 * - Zero path tokenization issues
 *
 * **Preview Mode: esbuild Watch with HMR**
 * - Incremental rebuilds (~10-50ms)
 * - WebSocket-based HMR for instant updates
 * - Multi-project context management with LRU eviction
 * - Local-only caching
 *
 * @module bundler
 */

// Build configuration
export {
  type BundleConfig,
  createBareImportPlugin,
  createBuildOptions,
  createHmrPlugin,
  createHmrRuntime,
  createJitBuildOptions,
  createPreviewBuildOptions,
  createVirtualFsPlugin,
  getLoaderForPath,
  getReactCDNMapping,
  getReactExternals,
  type SharedBuildConfig,
} from "./build-config.ts";

// Bundle cache
export {
  BundleCache,
  type BundleCacheConfig,
  type BundleCacheEntry,
  computeProjectContentHash,
  getBundleCache,
  resetBundleCache,
} from "./bundle-cache.ts";

// JIT bundler (production)
export {
  buildBundleFromFiles,
  getOrBuildBundle,
  hasCachedBundle,
  invalidateProjectBundles,
  type JitBundleOptions,
  type JitBundleResult,
} from "./jit-bundler.ts";

// Preview bundler (development)
export {
  getPreviewBundler,
  type HmrMessage,
  PreviewBundler,
  type PreviewBundlerConfig,
  type ProjectContext,
  resetPreviewBundler,
} from "./preview-bundler.ts";

// Bundle executor
export {
  type BundleModule,
  clearAllModules,
  clearModuleCache,
  clearProjectModules,
  executeBundle,
  executeBundleForRender,
  type ExecuteOptions,
  getModuleCacheStats,
} from "./bundle-executor.ts";
