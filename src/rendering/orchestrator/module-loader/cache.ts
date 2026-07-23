/**
 * Module Loader Cache Utilities
 *
 * Provides hash generation and cache factory functions.
 * Module caches are now pod-level singletons (see src/cache/module-cache.ts)
 * to ensure caches persist across requests within the same pod.
 *
 * @module rendering/orchestrator/module-loader/cache
 */

export { createEsmCache, createModuleCache } from "#veryfront/cache/module-cache.ts";
import { computeHash } from "#veryfront/utils";

export async function generateHash(str: string): Promise<string> {
  return (await computeHash(str)).slice(0, 16);
}
