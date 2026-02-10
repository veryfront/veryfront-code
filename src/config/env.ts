/****
 * Centralized environment accessors.
 *
 * Most functions read from EnvironmentConfig (cached at startup) and accept an
 * optional EnvironmentConfig parameter for test isolation.
 *
 * Provider env config functions (getOpenAIEnvConfig, getAnthropicEnvConfig,
 * getGoogleGenAIEnvConfig) read from getEnv() directly so they pick up
 * per-request project-scoped env vars from AsyncLocalStorage.
 *
 * @module
 */

import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export function getDisableLruIntervalEnv(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.disableLruInterval;
}

export function getApiBaseUrlEnv(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return env.apiBaseUrl;
}

export function getSsrMaxConcurrentTransformsEnv(
  defaultValue = 3,
  env: EnvironmentConfig = getEnvironmentConfig(),
): number {
  return env.ssrMaxConcurrentTransforms || defaultValue;
}

export function getRedisUrlEnv(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.redisUrl;
}

export function getV8FlagsEnv(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return env.denoV8Flags;
}

export function getCacheDirEnv(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.cacheDir;
}

export function isPerfEnabledEnv(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.perfEnabled;
}

export function getGithubEnvConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  token?: string;
  owner?: string;
  repo?: string;
  ref?: string;
} {
  return {
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubRepo,
    ref: env.githubRef,
  };
}

export function getApiTokenEnv(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.apiToken;
}

export function getOpenAIEnvConfig(): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: getEnv("OPENAI_API_KEY"),
    baseURL: getEnv("OPENAI_BASE_URL") || undefined,
  };
}

export function getAnthropicEnvConfig(): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: getEnv("ANTHROPIC_API_KEY"),
    baseURL: getEnv("ANTHROPIC_BASE_URL") || undefined,
  };
}

export function getGoogleGenAIEnvConfig(): {
  apiKey?: string;
} {
  return { apiKey: getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY") };
}

export function isDebugEnvEnabled(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.debug;
}

export function isCiEnv(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.ci;
}

export function isDenoTestingEnv(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.denoTesting;
}

export function getNoColorEnv(env: EnvironmentConfig = getEnvironmentConfig()): string | undefined {
  return env.noColor ? "1" : undefined;
}

export function getForceColorEnv(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.forceColor ? "1" : undefined;
}

export function isRscExperimentalEnabled(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  return env.experimentalRsc;
}

export function getVeryfrontVersion(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.veryfrontVersion;
}

export function getEnvironmentFromEnv(
  env: EnvironmentConfig = getEnvironmentConfig(),
): string | undefined {
  return env.veryfrontEnv || env.nodeEnv;
}

export function getOtelTracingConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  enabledFlag?: string;
  veryfrontFlag?: string;
  serviceName?: string;
  endpoint?: string;
  tracesEndpoint?: string;
  exporter?: string;
  headers?: string;
  tracesHeaders?: string;
} {
  const enabledFlag = env.otelEnabled ? "true" : undefined;
  const veryfrontFlag = env.otelEnabled ? "1" : undefined;

  return {
    enabledFlag,
    veryfrontFlag,
    serviceName: env.otelServiceName,
    endpoint: env.otelEndpoint,
    tracesEndpoint: env.otelTracesEndpoint,
    exporter: env.otelTracesExporter,
    headers: env.otelHeaders,
    tracesHeaders: undefined,
  };
}

export function getOtelMetricsConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  enabledFlag?: string;
  veryfrontFlag?: string;
  endpoint?: string;
  metricsEndpoint?: string;
  exporter?: string;
} {
  return {
    enabledFlag: env.otelMetricsEnabled ? "1" : undefined,
    veryfrontFlag: env.otelEnabled ? "1" : undefined,
    endpoint: env.otelEndpoint,
    metricsEndpoint: env.otelMetricsEndpoint,
    exporter: env.otelMetricsExporter,
  };
}
