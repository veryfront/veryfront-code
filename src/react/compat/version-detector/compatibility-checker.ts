import type { CompatibilityCheckResult, ReactFeatures, SSRMethod } from "./types.ts";
import { getReactVersionInfo } from "./version-cache.ts";

const REACT_19_FEATURES: Array<keyof ReactFeatures> = [
  "useFormStatus",
  "useOptimistic",
  "serverActions",
  "improvedSuspense",
  "enhancedStreaming",
];

const REACT_18_FEATURES: Array<keyof ReactFeatures> = [
  "streaming",
  "transitions",
  "suspense",
  "automaticBatching",
  "renderToPipeableStream",
  "renderToReadableStream",
];

export function checkVersionCompatibility(
  requiredFeatures: Array<keyof ReactFeatures>,
): CompatibilityCheckResult {
  const info = getReactVersionInfo();
  const warnings: string[] = [];
  const errors: string[] = [];
  let compatible = true;

  for (const feature of requiredFeatures) {
    if (!info.features[feature]) {
      if (REACT_19_FEATURES.includes(feature)) {
        warnings.push(`Feature "${feature}" requires React 19 (current: ${info.version})`);
      } // React 18+ features - errors (hard requirement)
      else if (REACT_18_FEATURES.includes(feature)) {
        errors.push(`Feature "${feature}" requires React 18+ (current: ${info.version})`);
        compatible = false;
      } // Other features - errors
      else {
        errors.push(`Feature "${feature}" is not available (current: React ${info.version})`);
        compatible = false;
      }
    }
  }

  return { compatible, warnings, errors };
}

export function getRecommendedSSRMethod(): SSRMethod {
  const info = getReactVersionInfo();

  if (info.isReact19 || (info.isReact18 && info.features.renderToReadableStream)) {
    return "readable-stream";
  } else if (info.isReact18 && info.features.renderToPipeableStream) {
    return "stream";
  } else {
    return "string";
  }
}
