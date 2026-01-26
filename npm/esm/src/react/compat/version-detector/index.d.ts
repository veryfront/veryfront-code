export type { CompatibilityCheckResult, ParsedVersion, ReactFeatures, ReactVersionInfo, SSRMethod, } from "./types.js";
export { parseVersion } from "./version-parser.js";
export { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.js";
export { __resetReactVersionCacheForTests, clearProjectVersionCache, getReactVersionInfo, getReactVersionInfoForProject, hasFeature, } from "./version-cache.js";
export { checkVersionCompatibility, getRecommendedSSRMethod } from "./compatibility-checker.js";
//# sourceMappingURL=index.d.ts.map