import type { CompatibilityCheckResult, ReactFeatures, SSRMethod } from "./types.js";
import { getReactVersionInfo } from "./version-cache.js";

const REACT_19_FEATURES: ReadonlySet<keyof ReactFeatures> = new Set([
  "useFormStatus",
  "useOptimistic",
  "serverActions",
  "improvedSuspense",
  "enhancedStreaming",
]);

const REACT_18_FEATURES: ReadonlySet<keyof ReactFeatures> = new Set([
  "streaming",
  "transitions",
  "suspense",
  "automaticBatching",
  "renderToPipeableStream",
  "renderToReadableStream",
]);

export function checkVersionCompatibility(
  requiredFeatures: Array<keyof ReactFeatures>,
): CompatibilityCheckResult {
  const info = getReactVersionInfo();
  const warnings: string[] = [];
  const errors: string[] = [];
  let compatible = true;

  for (const feature of requiredFeatures) {
    if (info.features[feature]) continue;

    if (REACT_19_FEATURES.has(feature)) {
      warnings.push(`Feature "${feature}" requires React 19 (current: ${info.version})`);
      continue;
    }

    if (REACT_18_FEATURES.has(feature)) {
      errors.push(`Feature "${feature}" requires React 18+ (current: ${info.version})`);
      compatible = false;
      continue;
    }

    errors.push(`Feature "${feature}" is not available (current: React ${info.version})`);
    compatible = false;
  }

  return { compatible, warnings, errors };
}

export function getRecommendedSSRMethod(): SSRMethod {
  const { isReact18, isReact19, features } = getReactVersionInfo();

  if (isReact19 || (isReact18 && features.renderToReadableStream)) return "readable-stream";
  if (isReact18 && features.renderToPipeableStream) return "stream";
  return "string";
}
