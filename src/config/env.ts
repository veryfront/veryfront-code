/****
 * Centralized environment accessors.
 *
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 * All functions accept an optional RuntimeEnv parameter for test isolation.
 *
 * @module
 */

import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env.ts";

export function getDisableLruIntervalEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.disableLruInterval;
}

export function getApiBaseUrlEnv(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.apiBaseUrl;
}

export function getSsrMaxConcurrentTransformsEnv(
  defaultValue = 3,
  env: RuntimeEnv = getRuntimeEnv(),
): number {
  return env.ssrMaxConcurrentTransforms || defaultValue;
}

export function getRedisUrlEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.redisUrl;
}

export function getV8FlagsEnv(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.denoV8Flags;
}

export function getCacheDirEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.cacheDir;
}

export function isPerfEnabledEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.perfEnabled;
}

export function getGithubEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
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

export function getApiTokenEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.apiToken;
}

export function getOpenAIEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
  apiKey?: string;
  baseURL?: string;
  organizationId?: string;
} {
  return {
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl,
    organizationId: undefined, // Not in RuntimeEnv, kept for interface compatibility
  };
}

export function getAnthropicEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: env.anthropicApiKey,
    baseURL: env.anthropicBaseUrl,
  };
}

export function getGoogleGenAIEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
  apiKey?: string;
} {
  return { apiKey: env.googleApiKey };
}

export function isDebugEnvEnabled(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.debug;
}

export function isCiEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.ci;
}

export function isDenoTestingEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.denoTesting;
}

export function getNoColorEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.noColor ? "1" : undefined;
}

export function getForceColorEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.forceColor ? "1" : undefined;
}

export function isRscExperimentalEnabled(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.experimentalRsc;
}

export function getVeryfrontVersion(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.veryfrontVersion;
}

export function getEnvironmentFromEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.veryfrontEnv || env.nodeEnv;
}

export function getOtelTracingConfig(env: RuntimeEnv = getRuntimeEnv()): {
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

export function getOtelMetricsConfig(env: RuntimeEnv = getRuntimeEnv()): {
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
