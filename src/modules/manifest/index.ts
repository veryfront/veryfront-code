/**
 * Module Manifest - Barrel Exports
 *
 * @module module-system/manifest
 */

export {
  clearAllManifests,
  clearProjectManifests,
  finishModuleCollection,
  generateModulePreloadHintsFromManifest,
  getCriticalModulePaths,
  getManifestStats,
  // Manifest management
  getRouteManifest,
  getRouteModulePaths,
  recordModuleLoad,
  recordSSRModules,
  // Collection API
  startModuleCollection,
} from "./route-module-manifest.ts";
