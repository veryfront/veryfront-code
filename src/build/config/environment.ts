/**
 * Centralized environment configuration for build module
 * Consolidates all environment variable access to reduce proliferation
 */

import { getEnv } from "../../platform/compat/process.ts";

export type Environment = "development" | "production" | "test";

/**
 * Get the current environment from environment variables
 * Checks multiple sources in order of precedence
 */
export function getEnvironment(): Environment {
  // Check framework-specific env first (highest priority)
  const veryfrontEnv = getEnv("VERYFRONT_ENV");
  if (veryfrontEnv === "production" || veryfrontEnv === "development" || veryfrontEnv === "test") {
    return veryfrontEnv as Environment;
  }

  // Check Node.js standard env
  const nodeEnv = getEnv("NODE_ENV");
  if (nodeEnv === "production" || nodeEnv === "development" || nodeEnv === "test") {
    return nodeEnv as Environment;
  }

  // Check Deno env
  const denoEnv = getEnv("DENO_ENV");
  if (denoEnv === "production" || denoEnv === "development" || denoEnv === "test") {
    return denoEnv as Environment;
  }

  // Default to development
  return "development";
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvironment() === "development";
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnvironment() === "production";
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return getEnvironment() === "test";
}

/**
 * Get environment-specific configuration values
 */
export interface BuildEnvironmentConfig {
  environment: Environment;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  // Cache settings
  cacheMaxEntries: number;
  cacheTTLMs: number;
  // Build settings
  minify: boolean;
  sourcemaps: boolean | "inline";
  treeShaking: boolean;
  target: string[];
}

/**
 * Get complete environment configuration for build
 */
export function getBuildConfig(): BuildEnvironmentConfig {
  const env = getEnvironment();
  const isDev = env === "development";
  const isProd = env === "production";
  const isTestEnv = env === "test";

  return {
    environment: env,
    isDevelopment: isDev,
    isProduction: isProd,
    isTest: isTestEnv,
    // Cache settings
    cacheMaxEntries: isDev ? 10 : 100,
    cacheTTLMs: isDev ? 0 : 3600000, // 0 = no expiration in dev, 1 hour in prod
    // Build settings
    minify: isProd,
    sourcemaps: isDev ? "inline" : false,
    treeShaking: isProd,
    target: isProd ? ["es2020"] : ["esnext"],
  };
}

/**
 * Environment variable for esbuild define plugin
 * Returns the proper value for process.env.NODE_ENV substitution
 */
export function getDefineEnv(): string {
  const env = getEnvironment();
  return JSON.stringify(env);
}
