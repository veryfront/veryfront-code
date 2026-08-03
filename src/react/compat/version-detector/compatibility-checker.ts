import type {
  CompatibilityCheckResult,
  ReactFeatures,
  ReactVersionInfo,
  SSRMethod,
} from "./types.ts";
import { getReactVersionInfo } from "./version-cache.ts";

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

export function checkVersionCompatibilityForInfo(
  info: ReactVersionInfo,
  requiredFeatures: Array<keyof ReactFeatures>,
): CompatibilityCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let compatible = true;

  for (const feature of requiredFeatures) {
    if (info.features[feature]) continue;

    if (REACT_19_FEATURES.has(feature)) {
      errors.push(`Feature "${feature}" requires React 19+ (current: ${info.version})`);
      compatible = false;
      continue;
    }

    const isReact18Feature = REACT_18_FEATURES.has(feature);
    const message = isReact18Feature
      ? `Feature "${feature}" requires React 18+ (current: ${info.version})`
      : `Feature "${feature}" is not available (current: React ${info.version})`;

    errors.push(message);
    compatible = false;
  }

  return { compatible, warnings, errors };
}

export function checkVersionCompatibility(
  requiredFeatures: Array<keyof ReactFeatures>,
): CompatibilityCheckResult {
  return checkVersionCompatibilityForInfo(
    getReactVersionInfo(),
    requiredFeatures,
  );
}

export function getRecommendedSSRMethod(): SSRMethod {
  const { features } = getReactVersionInfo();

  if (features.renderToReadableStream) return "readable-stream";
  if (features.renderToPipeableStream) return "stream";
  return "string";
}
