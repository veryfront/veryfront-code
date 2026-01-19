/**
 * Centralized environment accessors.
 *
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 * All functions accept an optional RuntimeEnv parameter for test isolation.
 *
 * @module
 */

import { getRuntimeEnv, type RuntimeEnv } from "./runtime-env.ts";

/**
 * Check if LRU interval cleanup is disabled.
 */
export function getDisableLruIntervalEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.disableLruInterval;
}

/**
 * Get the API base URL.
 */
export function getApiBaseUrlEnv(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.apiBaseUrl;
}

/**
 * Get max concurrent SSR transforms.
 */
export function getSsrMaxConcurrentTransformsEnv(
  defaultValue = 3,
  env: RuntimeEnv = getRuntimeEnv(),
): number {
  return env.ssrMaxConcurrentTransforms || defaultValue;
}

/**
 * Get Redis URL if configured.
 */
export function getRedisUrlEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.redisUrl;
}

/**
 * Get Deno V8 flags.
 */
export function getV8FlagsEnv(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.denoV8Flags;
}

/**
 * Get cache directory path.
 */
export function getCacheDirEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.cacheDir;
}

/**
 * Check if performance logging is enabled.
 */
export function isPerfEnabledEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.perfEnabled;
}

/**
 * Get GitHub configuration from environment.
 */
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

/**
 * Get API token.
 */
export function getApiTokenEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.apiToken;
}

/**
 * Get OpenAI configuration from environment.
 */
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

/**
 * Get Anthropic configuration from environment.
 */
export function getAnthropicEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: env.anthropicApiKey,
    baseURL: env.anthropicBaseUrl,
  };
}

/**
 * Get Google Generative AI configuration from environment.
 */
export function getGoogleGenAIEnvConfig(env: RuntimeEnv = getRuntimeEnv()): {
  apiKey?: string;
} {
  return {
    apiKey: env.googleApiKey,
  };
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnvEnabled(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.debug;
}

/**
 * Check if running in CI environment.
 */
export function isCiEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.ci;
}

/**
 * Check if running in Deno test environment.
 */
export function isDenoTestingEnv(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.denoTesting;
}

/**
 * Get NO_COLOR environment value.
 */
export function getNoColorEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.noColor ? "1" : undefined;
}

/**
 * Get FORCE_COLOR environment value.
 */
export function getForceColorEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.forceColor ? "1" : undefined;
}

/**
 * Check if RSC experimental feature is enabled.
 */
export function isRscExperimentalEnabled(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.experimentalRsc;
}

/**
 * Get Veryfront version.
 */
export function getVeryfrontVersion(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.veryfrontVersion;
}

/**
 * Get environment name (development, production, test).
 */
export function getEnvironmentFromEnv(env: RuntimeEnv = getRuntimeEnv()): string | undefined {
  return env.veryfrontEnv || env.nodeEnv;
}

/**
 * Get OpenTelemetry tracing configuration from environment.
 */
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
  return {
    enabledFlag: env.otelEnabled ? "1" : undefined,
    veryfrontFlag: env.otelEnabled ? "1" : undefined,
    serviceName: env.otelServiceName,
    endpoint: env.otelEndpoint,
    tracesEndpoint: env.otelTracesEndpoint,
    exporter: env.otelTracesExporter,
    headers: undefined, // Not currently in RuntimeEnv
    tracesHeaders: undefined, // Not currently in RuntimeEnv
  };
}

/**
 * Get OpenTelemetry metrics configuration from environment.
 */
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
