/**
 * Cross-platform environment helpers for local AI provider.
 *
 * Uses the platform compat layer so all local-AI checks go through
 * a single function — no duplicated env access patterns.
 *
 * @module provider/local
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

const LOCAL_AI_DISABLED_MESSAGE =
  "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.";

/**
 * Check whether local AI is explicitly disabled via environment variable.
 * Works in Deno, Node, and compiled binaries.
 */
export function isLocalAIDisabled(): boolean {
  return getEnv("VERYFRONT_DISABLE_LOCAL_AI") === "1";
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
