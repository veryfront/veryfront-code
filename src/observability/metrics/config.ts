import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { MetricsConfig } from "./types.ts";
import { memoryUsage as platformMemoryUsage } from "#veryfront/platform/compat/process.ts";
import { getOtelMetricsConfig } from "#veryfront/config/env.ts";

const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;

export const DEFAULT_CONFIG: MetricsConfig = {
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  debug: false,
};

function getEnvVar(env: unknown, key: string): string | undefined {
  const envObj = env as Record<string, unknown> | null | undefined;

  const getter = envObj?.get;
  if (typeof getter === "function") {
    return (getter as (k: string) => string | undefined)(key);
  }

  const value = envObj?.[key];
  return typeof value === "string" ? value : undefined;
}

function isValidExporter(
  exporter: unknown,
): exporter is "prometheus" | "otlp" | "console" {
  return exporter === "prometheus" || exporter === "otlp" ||
    exporter === "console";
}

export function loadConfig(
  config: Partial<MetricsConfig>,
  adapter?: RuntimeAdapter,
): MetricsConfig {
  const finalConfig: MetricsConfig = { ...DEFAULT_CONFIG, ...config };

  const applyEnvConfig = (opts: {
    enabledFlag?: string;
    veryfrontFlag?: string;
    endpoint?: string;
    metricsEndpoint?: string;
    exporter?: unknown;
  }): void => {
    finalConfig.enabled = opts.enabledFlag === "true" ||
      opts.veryfrontFlag === "1" ||
      finalConfig.enabled;

    finalConfig.endpoint = opts.endpoint || opts.metricsEndpoint ||
      finalConfig.endpoint;

    if (isValidExporter(opts.exporter)) {
      finalConfig.exporter = opts.exporter;
    }
  };

  if (adapter?.env) {
    const env = adapter.env;
    applyEnvConfig({
      enabledFlag: getEnvVar(env, "OTEL_METRICS_ENABLED"),
      veryfrontFlag: getEnvVar(env, "VERYFRONT_OTEL"),
      endpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      metricsEndpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
      exporter: getEnvVar(env, "OTEL_METRICS_EXPORTER"),
    });
    return finalConfig;
  }

  try {
    const metricsConfig = getOtelMetricsConfig();
    applyEnvConfig({
      enabledFlag: metricsConfig.enabledFlag,
      veryfrontFlag: metricsConfig.veryfrontFlag,
      endpoint: metricsConfig.endpoint,
      metricsEndpoint: metricsConfig.metricsEndpoint,
      exporter: metricsConfig.exporter,
    });
  } catch {
    // getEnv access may fail, silently continue
  }

  return finalConfig;
}

export function getMemoryUsage(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
} | null {
  try {
    return platformMemoryUsage();
  } catch {
    return null;
  }
}
