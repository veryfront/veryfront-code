/**
 * Metrics Configuration
 * Configuration loading and defaults for metrics system
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MetricsConfig } from "./types.ts";
import { memoryUsage as platformMemoryUsage } from "@veryfront/platform/compat/process.ts";
import { getOtelMetricsConfig } from "@veryfront/config/env.ts";

/**
 * Default metrics collect interval in milliseconds (60 seconds)
 * Inlined to avoid circular dependency with @veryfront/config
 */
const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;

/**
 * Default metrics configuration
 */
export const DEFAULT_CONFIG: MetricsConfig = {
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  debug: false,
};

/**
 * Load metrics configuration from environment and options
 */
/**
 * Get an environment variable from the adapter, supporting both
 * Deno-style (env.get(key)) and Node.js-style (env[key]) adapters.
 */
function getEnvVar(
  env: unknown,
  key: string,
): string | undefined {
  const envObj = env as Record<string, unknown>;
  if (typeof envObj?.get === "function") {
    return (envObj.get as (k: string) => string | undefined)(key);
  }
  // Node.js style - direct property access
  const value = envObj?.[key];
  return typeof value === "string" ? value : undefined;
}

export function loadConfig(
  config: Partial<MetricsConfig>,
  adapter?: RuntimeAdapter,
): MetricsConfig {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Check environment variables for configuration
  if (adapter?.env) {
    const envAdapter = adapter.env;
    const otelEnabled = getEnvVar(envAdapter, "OTEL_METRICS_ENABLED");
    const veryfrontOtel = getEnvVar(envAdapter, "VERYFRONT_OTEL");

    finalConfig.enabled = otelEnabled === "true" ||
      veryfrontOtel === "1" ||
      finalConfig.enabled;

    const otlpEndpoint = getEnvVar(envAdapter, "OTEL_EXPORTER_OTLP_ENDPOINT");
    const metricsEndpoint = getEnvVar(
      envAdapter,
      "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    );
    finalConfig.endpoint = otlpEndpoint || metricsEndpoint ||
      finalConfig.endpoint;

    const exporterType = getEnvVar(envAdapter, "OTEL_METRICS_EXPORTER");
    if (
      exporterType === "prometheus" || exporterType === "otlp" ||
      exporterType === "console"
    ) {
      finalConfig.exporter = exporterType;
    }
  } else {
    // Fallback to platform getEnv for cross-platform compatibility
    try {
      const metricsConfig = getOtelMetricsConfig();
      finalConfig.enabled = metricsConfig.enabledFlag === "true" ||
        metricsConfig.veryfrontFlag === "1" ||
        finalConfig.enabled;
      finalConfig.endpoint = metricsConfig.endpoint ||
        metricsConfig.metricsEndpoint ||
        finalConfig.endpoint;
      const exporterType = metricsConfig.exporter;
      if (
        exporterType === "prometheus" || exporterType === "otlp" ||
        exporterType === "console"
      ) {
        finalConfig.exporter = exporterType;
      }
    } catch {
      // getEnv access may fail, silently continue
    }
  }

  return finalConfig;
}

/**
 * Get memory usage from runtime (Deno or Node.js)
 */
export function getMemoryUsage(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
} | null {
  try {
    // Use platform abstraction for cross-platform compatibility
    return platformMemoryUsage();
  } catch {
    return null;
  }
}
