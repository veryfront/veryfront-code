/**
 * Module Cache
 *
 * Caching utilities for transformed modules and ESM modules.
 *
 * @module rendering/orchestrator/module-loader/cache
 */

/**
 * Generate a short hash from a string.
 * Used to create unique filenames for cached modules.
 */
export async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Creates a new module cache instance.
 * Module caches store transformed modules to avoid reprocessing.
 */
export function createModuleCache(): Map<string, string> {
  return new Map<string, string>();
}

/**
 * Creates a new ESM cache instance.
 * ESM caches store fetched esm.sh modules.
 */
export function createEsmCache(): Map<string, string> {
  return new Map<string, string>();
}
