export type { TransformContext, TransformOptions } from "./esm/types.ts";
export { needsTransform, transformToESM } from "./esm/index.ts";

export {
  addDepsToEsmShUrls,
  computeContentHash,
  computeShortContentHash,
  getLoaderFromPath,
  resolvePathAliases,
  resolveReactImports,
  resolveRelativeImports,
  rewriteBareImports,
  rewriteVendorImports,
} from "./esm/index.ts";
