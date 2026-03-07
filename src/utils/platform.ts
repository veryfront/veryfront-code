/**
 * Platform detection utilities
 */

import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { execPath } from "#veryfront/platform/compat/process.ts";

/**
 * Detect if the code is running in a compiled Deno binary
 * @returns true if running in a compiled binary, false otherwise
 */
export function isCompiledBinary(): boolean {
  if (!isDeno) return false;

  try {
    return execPath().includes("veryfront");
  } catch (_) {
    /* expected: execPath may not be available on all platforms */
    return false;
  }
}
