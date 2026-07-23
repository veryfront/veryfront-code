/**
 * Build Renderer
 *
 * @module build/renderer
 */

// Keep this compatibility barrel selective. Build implementations use direct
// imports so adding an export here does not broaden their dependency graph.

export type {
  BundleResult,
  BundlerOptions,
  EmbeddedBundleManifest,
  MDXBundleOptions,
  MDXBundleResult,
} from "./types/bundler-types.ts";

export { bundleCss, extractCssVariables } from "./services/css-bundler.ts";
export { bundleMdx, bundleMDXWithOptions } from "./services/mdx-bundler.ts";
export { optimizeBundle } from "./services/optimizer.ts";
export { bundleScript } from "./services/script-bundler.ts";

export {
  extractImports,
  findComponent,
  processImports,
  resolveImportPath,
} from "./utils/import-utils.ts";

export { getFileType, getLoaderFromPath, getSlugFromPath } from "./utils/loader-utils.ts";
