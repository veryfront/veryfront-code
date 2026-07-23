/**
 * Shared build utilities and compatibility exports for legacy renderer helpers.
 *
 * @module build/utils
 */

export {
  calculateAspectRatio,
  CSS_EXTENSIONS,
  findCSSFiles,
  generateSrcSet,
  getImageDimensions,
  getOptimizedFormat,
  getStandardPseudoSelectors,
  getVariantPath,
  globFiles,
  isImageFile,
  isPseudoSelector,
  matchesGlob,
} from "./asset-utils.ts";

export {
  extractImports,
  findComponent,
  processImports,
  resolveImportPath,
} from "../renderer/utils/import-utils.ts";
export { getFileType, getLoaderFromPath, getSlugFromPath } from "../renderer/utils/loader-utils.ts";
