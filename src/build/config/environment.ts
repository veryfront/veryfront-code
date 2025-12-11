
import { getEnv } from "../../platform/compat/process.ts";

export type Environment = "development" | "production" | "test";

export function getEnvironment(): Environment {
  const veryfrontEnv = getEnv("VERYFRONT_ENV");
  if (veryfrontEnv === "production" || veryfrontEnv === "development" || veryfrontEnv === "test") {
    return veryfrontEnv as Environment;
  }

  const nodeEnv = getEnv("NODE_ENV");
  if (nodeEnv === "production" || nodeEnv === "development" || nodeEnv === "test") {
    return nodeEnv as Environment;
  }

  const denoEnv = getEnv("DENO_ENV");
  if (denoEnv === "production" || denoEnv === "development" || denoEnv === "test") {
    return denoEnv as Environment;
  }

  return "development";
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
  const env = getEnvironment();
  const isDev = env === "development";
  const isProd = env === "production";
  const isTestEnv = env === "test";

  return {
    environment: env,
    isDevelopment: isDev,
    isProduction: isProd,
    isTest: isTestEnv,
    cacheMaxEntries: isDev ? 10 : 100,
    cacheTTLMs: isDev ? 0 : 3600000,
    minify: isProd,
    sourcemaps: isDev ? "inline" : false,
    treeShaking: isProd,
    target: isProd ? ["es2020"] : ["esnext"],
  };
}

export function getDefineEnv(): string {
  const env = getEnvironment();
  return JSON.stringify(env);
}
