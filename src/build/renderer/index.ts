// Main bundler exports
//
// NOTE: This barrel has zero external consumers. All imports within build/
// use direct deep paths (e.g. "../renderer/types/bundler-types.ts").
// Wildcards replaced with selective exports for the symbols actually
// used by sibling modules in src/build/.

export type {
  BundleResult,
  BundlerOptions,
  EmbeddedBundleManifest,
  MDXBundleOptions,
  MDXBundleResult,
} from "./types/bundler-types.ts";

export { bundleCss, extractCssVariables, processCssImports } from "./services/css-bundler.ts";
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
