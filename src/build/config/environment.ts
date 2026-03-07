import { getEnvironmentFromEnv } from "#veryfront/config/env.ts";

/** Max cache entries for development builds */
const DEV_CACHE_MAX_ENTRIES = 10;
/** Max cache entries for production builds */
const PROD_CACHE_MAX_ENTRIES = 100;
/** Cache TTL for production builds (1 hour) */
const PROD_CACHE_TTL_MS = 3_600_000;

export type Environment = "development" | "production" | "test";

function isEnvironment(value: unknown): value is Environment {
  return value === "development" || value === "production" || value === "test";
}

export function getEnvironment(): Environment {
  const env = getEnvironmentFromEnv();
  return isEnvironment(env) ? env : "development";
}

export function isDevelopment(): boolean {
  return getEnvironment() === "development";
}

export function isProduction(): boolean {
  return getEnvironment() === "production";
}

export function isTest(): boolean {
  return getEnvironment() === "test";
}

export interface BuildEnvironmentConfig {
  environment: Environment;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  cacheMaxEntries: number;
  cacheTTLMs: number;
  minify: boolean;
  sourcemaps: boolean | "inline";
  treeShaking: boolean;
  target: string[];
}

export function getBuildConfig(): BuildEnvironmentConfig {
  const environment = getEnvironment();
  const isDevelopment = environment === "development";
  const isProduction = environment === "production";
  const isTest = environment === "test";

  return {
    environment,
    isDevelopment,
    isProduction,
    isTest,
    cacheMaxEntries: isDevelopment ? DEV_CACHE_MAX_ENTRIES : PROD_CACHE_MAX_ENTRIES,
    cacheTTLMs: isDevelopment ? 0 : PROD_CACHE_TTL_MS,
    minify: isProduction,
    sourcemaps: isDevelopment ? "inline" : false,
    treeShaking: isProduction,
    target: isProduction ? ["es2020"] : ["esnext"],
  };
}

export function getDefineEnv(): string {
  return JSON.stringify(getEnvironment());
}
