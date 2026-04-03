/**
 * Cross-platform environment helpers for local AI provider.
 *
 * Abstracts Deno/Node env access so all local-AI checks go through
 * a single function — no duplicated `globalThis.Deno?.env` patterns.
 *
 * @module provider/local
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

const LOCAL_AI_DISABLED_MESSAGE =
  "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.";

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

export function createLocalAIDisabledError(): Error {
  return toError(
    createError({
      type: "no_ai_available",
      message: LOCAL_AI_DISABLED_MESSAGE,
    }),
  );
}

export function throwIfLocalAIDisabled(): void {
  if (isLocalAIDisabled()) {
    throw createLocalAIDisabledError();
  }
}
