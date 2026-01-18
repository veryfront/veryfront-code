/**
 * Platform detection utilities
 */

import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { execPath } from "@veryfront/platform/compat/process.ts";

/**
 * Detect if the code is running in a compiled Deno binary
 * @returns true if running in a compiled binary, false otherwise
 */
export function isCompiledBinary(): boolean {
  if (!isDeno) return false;

  try {
    const path = execPath();
    return path.includes("veryfront");
  } catch {
    return false;
  }
}
