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

const HEX_CHARS = "0123456789abcdef";

export async function generateHash(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i] ?? 0;
    hex += (HEX_CHARS[byte >> 4] ?? "0") + (HEX_CHARS[byte & 0xf] ?? "0");
  }

  return hex;
}
