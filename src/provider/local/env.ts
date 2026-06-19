/**
 * Cross-platform environment helpers for local LLM provider.
 *
 * Uses the platform compat layer so all local-AI checks go through
 * a single function — no duplicated env access patterns.
 *
 * @module provider/local
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const LOCAL_AI_DISABLED_MESSAGE =
  "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.";
const LOCAL_AI_DEVICE_ENV = "VERYFRONT_LOCAL_AI_DEVICE";
const LOCAL_AI_THINKING_ENV = "VERYFRONT_LOCAL_AI_THINKING";

export type LocalAIDevice = "cpu" | "webgpu";

/**
 * Check whether local AI is explicitly disabled via environment variable.
 * Works in Deno, Node, and compiled binaries.
 */
export function isLocalAIDisabled(): boolean {
  return getHostEnv("VERYFRONT_DISABLE_LOCAL_AI") === "1";
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

export function getLocalAIDevice(): LocalAIDevice {
  const value = getHostEnv(LOCAL_AI_DEVICE_ENV);
  if (!value) return "cpu";

  const normalized = value.trim().toLowerCase();
  if (normalized === "cpu" || normalized === "webgpu") {
    return normalized;
  }

  throw toError(
    createError({
      type: "config",
      message:
        `Invalid ${LOCAL_AI_DEVICE_ENV} value "${value}". Supported values are "cpu" and "webgpu".`,
    }),
  );
}

export function getLocalAIThinkingEnabled(): boolean {
  const value = getHostEnv(LOCAL_AI_THINKING_ENV);
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (
    normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off"
  ) {
    return false;
  }

  throw toError(
    createError({
      type: "config",
      message:
        `Invalid ${LOCAL_AI_THINKING_ENV} value "${value}". Supported values are "1", "true", "yes", "on", "0", "false", "no", and "off".`,
    }),
  );
}
