/**
 * Low-level environment detection for the platform layer.
 *
 * Reads directly from process env vars (VERYFRONT_ENV, NODE_ENV) so that
 * bottom-layer and middle-layer modules can check the current environment
 * without importing from the config/ or build/ layers.
 *
 * @module platform/environment
 */

// Import from process/env.ts, not the process.ts barrel. This module is
// reachable from the `veryfront/chat` client entry, and the barrel also
// re-exports runCommand from process/command.ts, which pulls
// platform/compat/dynamic-import.ts and its `new Function` into the client
// bundle. Project pages ship a CSP without 'unsafe-eval', so that throws
// EvalError and kills hydration before first paint.
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";

export type Environment = "development" | "production" | "test";

const reflectApply = Reflect.apply;
const stringPrototypeToLowerCase = String.prototype.toLowerCase;
const stringPrototypeTrim = String.prototype.trim;

function toLowerCaseString(value: string): string {
  return reflectApply(stringPrototypeToLowerCase, value, []);
}

function trimString(value: string): string {
  return reflectApply(stringPrototypeTrim, value, []);
}

function resolveEnvironment(): Environment {
  let configured: string | undefined;
  for (const key of ["VERYFRONT_ENV", "NODE_ENV", "DENO_ENV"] as const) {
    // Runtime posture is framework-owned configuration. A tenant/project
    // environment overlay must never be able to weaken it for one request.
    const rawValue = getHostEnv(key);
    const value = rawValue === undefined ? undefined : toLowerCaseString(trimString(rawValue));
    if (value) {
      configured = value;
      break;
    }
  }

  if (configured === undefined || configured === "development") return "development";
  if (configured === "test") return "test";

  // Development-only behavior can relax authentication, diagnostics, and
  // storage defaults. Treat every explicit non-development deployment label
  // (including conventional values such as "preview" and "staging") with the
  // production posture so a typo cannot silently weaken those boundaries.
  return "production";
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
