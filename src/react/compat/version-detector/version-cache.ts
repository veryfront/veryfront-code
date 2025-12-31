import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.ts";

// Global cache for default React version (CLI's bundled React)
let defaultVersionInfo: ReactVersionInfo | null = null;

// Per-project cache keyed by projectDir for multi-tenant support
const projectVersionCache = new Map<string, ReactVersionInfo>();

/**
 * Get React version info for the current context.
 * For multi-tenant scenarios, use getReactVersionInfoForProject() instead.
 */
export function getReactVersionInfo(): ReactVersionInfo {
  if (!defaultVersionInfo) {
    defaultVersionInfo = detectReactVersion();
  }
  return defaultVersionInfo;
}

/**
 * Get React version info for a specific project directory.
 * This is the preferred method for multi-tenant rendering where
 * different projects may have different React versions.
 */
export async function getReactVersionInfoForProject(projectDir: string): Promise<ReactVersionInfo> {
  const cached = projectVersionCache.get(projectDir);
  if (cached) {
    return cached;
  }

  const info = await detectReactVersionFromProject(projectDir);
  projectVersionCache.set(projectDir, info);
  return info;
}

/**
 * Clear cached version info for a specific project.
 * Useful when a project's dependencies change.
 */
export function clearProjectVersionCache(projectDir: string): void {
  projectVersionCache.delete(projectDir);
}

export function hasFeature(feature: keyof ReactFeatures): boolean {
  const info = getReactVersionInfo();
  return info.features[feature];
}

export function __resetReactVersionCacheForTests(): void {
  defaultVersionInfo = null;
  projectVersionCache.clear();
}
