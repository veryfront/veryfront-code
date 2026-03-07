/**
 * Cross-platform environment helpers for local AI provider.
 *
 * Abstracts Deno/Node env access so all local-AI checks go through
 * a single function — no duplicated `globalThis.Deno?.env` patterns.
 *
 * @module provider/local
 */

/**
 * Check whether local AI is explicitly disabled via environment variable.
 * Works in Deno, Node, and compiled binaries.
 */
export function isLocalAIDisabled(): boolean {
  const denoVal = (globalThis as Record<string, unknown>).Deno as
    | { env?: { get?: (key: string) => string | undefined } }
    | undefined;
  const denoEnvVal = denoVal?.env?.get?.("VERYFRONT_DISABLE_LOCAL_AI");
  if (denoEnvVal === "1") return true;

  if (
    typeof process !== "undefined" &&
    process.env?.VERYFRONT_DISABLE_LOCAL_AI === "1"
  ) {
    return true;
  }

  return false;
}
