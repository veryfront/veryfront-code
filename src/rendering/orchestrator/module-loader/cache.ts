/**
 * Module Cache
 *
 * Caching utilities for transformed modules and ESM modules.
 *
 * @module rendering/orchestrator/module-loader/cache
 */

// Hex lookup table for efficient byte-to-hex conversion
const HEX_CHARS = "0123456789abcdef";

/**
 * Generate a short hash from a string.
 * Used to create unique filenames for cached modules.
 * Optimized single-pass hex encoding to avoid intermediate allocations.
 */
export async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  // Single-pass hex encoding without Array.from/map/join overhead
  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
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
