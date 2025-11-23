export type {
  CompatibilityCheckResult,
  ParsedVersion,
  ReactFeatures,
  ReactVersionInfo,
  SSRMethod,
} from "./types.ts";

export { parseVersion } from "./version-parser.ts";

export { detectReactVersion } from "./feature-detector.ts";

export {
  __resetReactVersionCacheForTests,
  getReactVersionInfo,
  hasFeature,
} from "./version-cache.ts";

export { checkVersionCompatibility, getRecommendedSSRMethod } from "./compatibility-checker.ts";
