/**
 * Platform detection utilities
 */

/**
 * Detect if the code is running in a compiled Deno binary
 * @returns true if running in a compiled binary, false otherwise
 */
export function isCompiledBinary(): boolean {
  const hasDeno = typeof Deno !== "undefined";
  const hasExecPath = hasDeno && typeof Deno.execPath === "function";

  if (!hasExecPath) return false;

  try {
    const execPath = Deno.execPath();
    return execPath.includes("veryfront");
  } catch {
    return false;
  }
}
