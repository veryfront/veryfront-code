import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { detectReactVersion } from "./feature-detector.ts";

let cachedVersionInfo: ReactVersionInfo | null = null;

export function getReactVersionInfo(): ReactVersionInfo {
  if (!cachedVersionInfo) {
    cachedVersionInfo = detectReactVersion();
  }
  return cachedVersionInfo;
}

export function hasFeature(feature: keyof ReactFeatures): boolean {
  const info = getReactVersionInfo();
  return info.features[feature];
}

export function __resetReactVersionCacheForTests(): void {
  cachedVersionInfo = null;
}
