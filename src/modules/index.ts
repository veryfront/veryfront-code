/**
 * ESM module system — component registry, import map resolution and merging,
 * SSR module caching, and path resolution for framework and user modules.
 *
 * @module modules
 */

export {
  type ComponentExports,
  type ComponentInfo,
  ComponentRegistry,
  type ComponentRegistryOptions,
} from "./component-registry/index.ts";

export {
  clearImportMapCache,
  getDefaultImportMap,
  type ImportMapConfig,
  loadImportMap,
  mergeImportMaps,
  preloadImportMap,
  resolveImport,
  transformImportsWithMap,
  type TransformOptions,
} from "./import-map/index.ts";

export {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  type ComponentMap,
  type ComponentSource,
  getGlobalTmpDir,
  getProjectTmpDir,
  loadComponentFromSource,
  type LoadComponentOptions,
  loadComponentsUnified,
  normalizeModulePath,
  resetGlobalTmpDir,
  resolveRelativePath,
} from "./react-loader/index.ts";

export { ModuleResolver } from "./module-resolver.ts";
export type { ModuleResolverOptions, ResolvedModule } from "./module-resolver.ts";
