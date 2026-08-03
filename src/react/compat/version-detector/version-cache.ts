import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.ts";

let defaultVersionInfo: ReactVersionInfo | null = null;

export function getReactVersionInfo(): ReactVersionInfo {
  defaultVersionInfo ??= detectReactVersion();
  return defaultVersionInfo;
}

export async function getReactVersionInfoForProject(
  projectDir: string,
): Promise<ReactVersionInfo> {
  // A project's package metadata can change independently of this module's
  // lifetime. The owning project/config lifecycle does not expose a reliable
  // invalidation signal here, so caching would return stale cross-request
  // results and require callers to coordinate a manual reset API.
  return await detectReactVersionFromProject(projectDir);
}

export function hasFeature(feature: keyof ReactFeatures): boolean {
  return getReactVersionInfo().features[feature];
}

export function __resetReactVersionCacheForTests(): void {
  defaultVersionInfo = null;
}
