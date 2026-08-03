/**
 * Platform detection utilities
 */

import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";

/**
 * Detect if the code is running in a compiled Deno binary
 * @returns true if running in a compiled binary, false otherwise
 */
export function isCompiledBinary(): boolean {
  return isDenoCompiled;
}
