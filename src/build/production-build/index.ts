/**
 * Build Module
 *
 * Build system utilities for production builds, asset generation, and static site generation.
 * Provides manifest generation, client runtime bundling, and static asset handling.
 *
 * @example
 * ```typescript
 * import { copyStaticAssets, generateManifest, buildPagesRoutes } from '@veryfront/server/build'
 *
 * // Copy static assets
 * await copyStaticAssets(adapter, projectDir, publicDir)
 *
 * // Generate build manifest
 * const manifest = generateManifest({ routes, assets })
 *
 * // Build pages routes for SSG
 * const stats = await buildPagesRoutes(options)
 * ```
 *
 * @module server/build
 */

// Asset generation
export { type AssetStats, copyStaticAssets, loadClientStyles } from "./asset-generation.ts";

// Client runtime generation
export {
  generateAppModule,
  generateClientModule,
  generateImportMap,
  generatePrefetchScript,
  generateRouterScript,
} from "./client-runtime.ts";

// Build manifest
export {
  type BuildManifest,
  generateManifest,
  generateRedirects,
  type ManifestOptions,
} from "./manifest.ts";

// Static site generation
export {
  buildAppRoutes,
  buildPagesRoutes,
  type PageRenderResult,
  type SSGOptions,
  type SSGStats,
} from "./static-generation.ts";

// Build orchestration (re-export from build/build subdirectory)
export * from "./build/index.ts";
