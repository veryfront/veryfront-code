/**
 * Low-level environment detection for the platform layer.
 *
 * Reads directly from host env vars (VERYFRONT_ENV, NODE_ENV, DENO_ENV) so that
 * bottom-layer and middle-layer modules can check the current environment
 * without importing from the config/ or build/ layers.
 *
 * @module platform/environment
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";

export type Environment = "development" | "production" | "test";

const ENVIRONMENT_VARIABLE_NAMES = ["VERYFRONT_ENV", "NODE_ENV", "DENO_ENV"] as const;
const ENVIRONMENTS = new Set<Environment>(["development", "production", "test"]);

function resolveEnvironment(): Environment {
  for (const name of ENVIRONMENT_VARIABLE_NAMES) {
    const value = getHostEnv(name);
    if (!value) continue;
    if (ENVIRONMENTS.has(value as Environment)) return value as Environment;

    throw INVALID_ARGUMENT.create({
      message: `${name} must be development, production, or test`,
    });
  }
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
