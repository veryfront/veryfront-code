/**
 * Compat - Version Detector
 *
 * @module react/compat/version-detector
 */

export type {
  CompatibilityCheckResult,
  ParsedVersion,
  ReactFeatures,
  ReactVersionInfo,
  SSRMethod,
} from "./types.ts";
export { parseVersion } from "./version-parser.ts";
export { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.ts";
export {
  clearProjectVersionCache,
  getReactVersionInfo,
  getReactVersionInfoForProject,
  hasFeature,
} from "./version-cache.ts";
export { checkVersionCompatibility, getRecommendedSSRMethod } from "./compatibility-checker.ts";
