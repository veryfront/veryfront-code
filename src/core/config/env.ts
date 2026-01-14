/**
 * Centralized environment accessors.
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 */

import { getEnv } from "@veryfront/platform/compat/process.ts";
import { isTruthyEnvValue } from "@veryfront/utils/constants/env.ts";

export function getDisableLruIntervalEnv(): boolean {
  return getEnv("VF_DISABLE_LRU_INTERVAL") === "1";
}

export function getApiBaseUrlEnv(): string {
  return getEnv("VERYFRONT_API_BASE_URL") ||
    getEnv("VERYFRONT_API_URL")?.replace("/graphql", "/api") ||
    "http://api.lvh.me:4000";
}

export function getSsrMaxConcurrentTransformsEnv(defaultValue = 3): number {
  const raw = getEnv("SSR_MAX_CONCURRENT_TRANSFORMS");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function getRedisUrlEnv(): string | undefined {
  return getEnv("REDIS_URL");
}

export function getV8FlagsEnv(): string {
  return getEnv("DENO_V8_FLAGS") ?? "";
}

export function getCacheDirEnv(): string | undefined {
  return getEnv("VF_CACHE_DIR");
}

export function isPerfEnabledEnv(): boolean {
  return getEnv("VERYFRONT_PERF") === "1";
}

export function getGithubEnvConfig(): {
  token?: string;
  owner?: string;
  repo?: string;
  ref?: string;
} {
  return {
    token: getEnv("GITHUB_TOKEN") || undefined,
    owner: getEnv("GITHUB_OWNER") || undefined,
    repo: getEnv("GITHUB_REPO") || undefined,
    ref: getEnv("GITHUB_REF") || undefined,
  };
}

export function getApiTokenEnv(): string | undefined {
  return getEnv("VERYFRONT_API_TOKEN");
}

export function getOpenAIEnvConfig(): {
  apiKey?: string;
  baseURL?: string;
  organizationId?: string;
} {
  return {
    apiKey: getEnv("OPENAI_API_KEY") || undefined,
    baseURL: getEnv("OPENAI_BASE_URL") || undefined,
    organizationId: getEnv("OPENAI_ORGANIZATION_ID") || undefined,
  };
}

export function getAnthropicEnvConfig(): {
  apiKey?: string;
  baseURL?: string;
} {
  return {
    apiKey: getEnv("ANTHROPIC_API_KEY") || undefined,
    baseURL: getEnv("ANTHROPIC_BASE_URL") || undefined,
  };
}

export function getGoogleGenAIEnvConfig(): {
  apiKey?: string;
} {
  return {
    apiKey: getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY") || undefined,
  };
}

export function isDebugEnvEnabled(): boolean {
  return isTruthyEnvValue(getEnv("VERYFRONT_DEBUG"));
}

export function isCiEnv(): boolean {
  return getEnv("CI") === "1";
}

export function isDenoTestingEnv(): boolean {
  return getEnv("DENO_TESTING") === "1";
}

export function getNoColorEnv(): string | undefined {
  return getEnv("NO_COLOR");
}

export function getForceColorEnv(): string | undefined {
  return getEnv("FORCE_COLOR");
}

export function isRscExperimentalEnabled(): boolean {
  return getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
}

export function getVeryfrontVersion(): string | undefined {
  return getEnv("VERYFRONT_VERSION");
}

export function getEnvironmentFromEnv(): string | undefined {
  return getEnv("VERYFRONT_ENV") || getEnv("NODE_ENV") || getEnv("DENO_ENV");
}

export function getOtelTracingConfig(): {
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
    enabledFlag: getEnv("OTEL_TRACES_ENABLED"),
    veryfrontFlag: getEnv("VERYFRONT_OTEL"),
    serviceName: getEnv("OTEL_SERVICE_NAME") || undefined,
    endpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    tracesEndpoint: getEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
    exporter: getEnv("OTEL_TRACES_EXPORTER") || undefined,
    headers: getEnv("OTEL_EXPORTER_OTLP_HEADERS") || undefined,
    tracesHeaders: getEnv("OTEL_EXPORTER_OTLP_TRACES_HEADERS") || undefined,
  };
}

export function getOtelMetricsConfig(): {
  enabledFlag?: string;
  veryfrontFlag?: string;
  endpoint?: string;
  metricsEndpoint?: string;
  exporter?: string;
} {
  return {
    enabledFlag: getEnv("OTEL_METRICS_ENABLED"),
    veryfrontFlag: getEnv("VERYFRONT_OTEL"),
    endpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    metricsEndpoint: getEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
    exporter: getEnv("OTEL_METRICS_EXPORTER") || undefined,
  };
}
