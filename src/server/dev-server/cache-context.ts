import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getProjectCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";

type EnvReader = (key: string) => string | undefined;

/** Resolve the cache root for the project served by a dev-server entry point. */
export function resolveDevServerCacheDir(
  projectDir: string,
  read: EnvReader = getHostEnv,
): string {
  return read("VERYFRONT_CACHE_DIR") ?? read("VF_CACHE_DIR") ?? getProjectCacheDir(projectDir);
}

/** Run dev-server startup or request work in its project cache context. */
export function runWithDevServerCacheDir<T>(
  projectDir: string,
  operation: () => T,
  read: EnvReader = getHostEnv,
): T {
  return runWithCacheDir(resolveDevServerCacheDir(projectDir, read), operation);
}
