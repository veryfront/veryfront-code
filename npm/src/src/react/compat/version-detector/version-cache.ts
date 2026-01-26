import type { ReactFeatures, ReactVersionInfo } from "./types.js";
import { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.js";

let defaultVersionInfo: ReactVersionInfo | null = null;
const projectVersionCache = new Map<string, ReactVersionInfo>();

export function getReactVersionInfo(): ReactVersionInfo {
  defaultVersionInfo ??= detectReactVersion();
  return defaultVersionInfo;
}

export async function getReactVersionInfoForProject(projectDir: string): Promise<ReactVersionInfo> {
  const cached = projectVersionCache.get(projectDir);
  if (cached) return cached;

  const info = await detectReactVersionFromProject(projectDir);
  projectVersionCache.set(projectDir, info);
  return info;
}

export function clearProjectVersionCache(projectDir: string): void {
  projectVersionCache.delete(projectDir);
}

export function hasFeature(feature: keyof ReactFeatures): boolean {
  return getReactVersionInfo().features[feature];
}

export function __resetReactVersionCacheForTests(): void {
  defaultVersionInfo = null;
  projectVersionCache.clear();
}
