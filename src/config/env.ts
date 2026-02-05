/****
 * Centralized environment accessors.
 *
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 * All functions accept an optional EnvironmentConfig parameter for test isolation.
 *
 * @module
 */

import { type EnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";

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

export function getOpenAIEnvConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  apiKey?: string;
  baseURL?: string;
  organizationId?: string;
} {
  return {
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl,
    organizationId: undefined, // Not in EnvironmentConfig, kept for interface compatibility
  };
}

export function getAnthropicEnvConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: env.anthropicApiKey,
    baseURL: env.anthropicBaseUrl,
  };
}

export function getGoogleGenAIEnvConfig(env: EnvironmentConfig = getEnvironmentConfig()): {
  apiKey?: string;
} {
  return { apiKey: env.googleApiKey };
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
