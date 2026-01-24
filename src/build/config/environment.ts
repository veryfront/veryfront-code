import { getEnvironmentFromEnv } from "#veryfront/config/env.ts";

export type Environment = "development" | "production" | "test";

function isEnvironment(value: unknown): value is Environment {
  return value === "development" || value === "production" || value === "test";
}

export function getEnvironment(): Environment {
  const veryfrontEnv = getEnvironmentFromEnv();
  if (isEnvironment(veryfrontEnv)) return veryfrontEnv;
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
  const environment = getEnvironment();
  const isDevelopment = environment === "development";
  const isProduction = environment === "production";
  const isTest = environment === "test";

  return {
    environment,
    isDevelopment,
    isProduction,
    isTest,
    cacheMaxEntries: isDevelopment ? 10 : 100,
    cacheTTLMs: isDevelopment ? 0 : 3600000,
    minify: isProduction,
    sourcemaps: isDevelopment ? "inline" : false,
    treeShaking: isProduction,
    target: isProduction ? ["es2020"] : ["esnext"],
  };
}

export function getDefineEnv(): string {
  return JSON.stringify(getEnvironment());
}
