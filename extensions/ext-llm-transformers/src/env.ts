/**
 * Cross-platform environment helpers for local LLM provider.
 *
 * This extension owns its cross-runtime environment reader so importing the
 * package cannot pull the framework's broader platform graph into its npm
 * artifact.
 *
 * @module extensions/ext-llm-transformers
 */

import { createError, toError } from "veryfront/errors";
import {
  DEFAULT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS,
  MAX_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS,
} from "./model-load-policy.ts";

const LOCAL_AI_DISABLED_MESSAGE =
  "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.";
const LOCAL_AI_DEVICE_ENV = "VERYFRONT_LOCAL_AI_DEVICE";
const LOCAL_AI_THINKING_ENV = "VERYFRONT_LOCAL_AI_THINKING";
const LOCAL_AI_MODEL_LOAD_TIMEOUT_ENV = "VERYFRONT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS";

export type LocalAIDevice = "cpu" | "webgpu";

interface EnvironmentRuntimeGlobals {
  Deno?: {
    env?: {
      get(name: string): string | undefined;
    };
  };
  process?: {
    env?: Record<string, string | undefined>;
  };
}

function getEnvironmentVariable(name: string): string | undefined {
  const runtime = globalThis as EnvironmentRuntimeGlobals;
  const denoEnvironment = runtime.Deno?.env;
  if (denoEnvironment) return denoEnvironment.get(name);

  const value = runtime.process?.env?.[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Check whether local AI is explicitly disabled via environment variable.
 * Works in Deno, Node, and compiled binaries.
 */
export function isLocalAIDisabled(): boolean {
  return getEnvironmentVariable("VERYFRONT_DISABLE_LOCAL_AI") === "1";
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
  const value = getEnvironmentVariable(LOCAL_AI_DEVICE_ENV);
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
  const value = getEnvironmentVariable(LOCAL_AI_THINKING_ENV);
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

export function getLocalAIModelLoadTimeoutMs(): number {
  const value = getEnvironmentVariable(LOCAL_AI_MODEL_LOAD_TIMEOUT_ENV);
  if (!value) return DEFAULT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS;

  if (!/^[1-9]\d*$/.test(value)) {
    throw toError(
      createError({
        type: "config",
        message:
          `${LOCAL_AI_MODEL_LOAD_TIMEOUT_ENV} must be a positive integer number of milliseconds`,
      }),
    );
  }

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS) {
    throw toError(
      createError({
        type: "config",
        message:
          `${LOCAL_AI_MODEL_LOAD_TIMEOUT_ENV} must not exceed ${MAX_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS}`,
      }),
    );
  }
  return timeoutMs;
}
