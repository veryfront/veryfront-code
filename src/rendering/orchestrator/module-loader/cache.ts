/**
 * Module Loader Cache Utilities
 *
 * Provides hash generation and cache factory functions.
 * Module caches are now pod-level singletons (see src/cache/module-cache.ts)
 * to ensure caches persist across requests within the same pod.
 *
 * @module rendering/orchestrator/module-loader/cache
 */

// Re-export pod-level cache factories
export { createEsmCache, createModuleCache } from "#veryfront/cache/module-cache.ts";

const HEX_CHARS = "0123456789abcdef";

export async function generateHash(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
}
