/**
 * Low-level environment detection for the platform layer.
 *
 * Reads directly from process env vars (VERYFRONT_ENV, NODE_ENV) so that
 * bottom-layer and middle-layer modules can check the current environment
 * without importing from the config/ or build/ layers.
 *
 * @module platform/environment
 */

import { getEnv } from "#veryfront/platform/compat/process.ts";

export type Environment = "development" | "production" | "test";

function resolveEnvironment(): Environment {
  const raw = getEnv("VERYFRONT_ENV") || getEnv("NODE_ENV") || getEnv("DENO_ENV");
  if (raw === "production" || raw === "test") return raw;
  return "development";
}

export function getEnvironment(): Environment {
  return resolveEnvironment();
}

export function isDevelopment(): boolean {
  return resolveEnvironment() === "development";
}

export function isProduction(): boolean {
  return resolveEnvironment() === "production";
}

export function isTest(): boolean {
  return resolveEnvironment() === "test";
}
