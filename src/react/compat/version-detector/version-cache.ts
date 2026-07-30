import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.ts";

let defaultVersionInfo: ReactVersionInfo | null = null;
const projectVersionCache = new Map<string, ReactVersionInfo>();

function projectCacheKey(projectDir: string, projectId?: string): string {
  return projectId === undefined ? `directory:${projectDir}` : `project:${projectId}`;
}

export function getReactVersionInfo(): ReactVersionInfo {
  defaultVersionInfo ??= detectReactVersion();
  return defaultVersionInfo;
}

export async function getReactVersionInfoForProject(
  projectDir: string,
  projectId?: string,
): Promise<ReactVersionInfo> {
  const cacheKey = projectCacheKey(projectDir, projectId);
  const cached = projectVersionCache.get(cacheKey);
  if (cached) return cached;

  const info = await detectReactVersionFromProject(projectDir);
  projectVersionCache.set(cacheKey, info);
  return info;
}

export function clearProjectVersionCache(projectIdOrDir: string): void {
  projectVersionCache.delete(`project:${projectIdOrDir}`);
  projectVersionCache.delete(`directory:${projectIdOrDir}`);
}

export function hasFeature(feature: keyof ReactFeatures): boolean {
  return getReactVersionInfo().features[feature];
}

export function __resetReactVersionCacheForTests(): void {
  defaultVersionInfo = null;
  projectVersionCache.clear();
}
