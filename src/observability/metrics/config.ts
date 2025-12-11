
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MetricsConfig } from "./types.ts";
import { getEnv } from "../../platform/compat/process.ts";
import { memoryUsage as platformMemoryUsage } from "../../platform/compat/process.ts";

const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;

export const DEFAULT_CONFIG: MetricsConfig = {
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  debug: false,
};

export function loadConfig(
  config: Partial<MetricsConfig>,
  adapter?: RuntimeAdapter,
): MetricsConfig {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (adapter?.env) {
    const envAdapter = adapter.env;
    const otelEnabled = envAdapter.get("OTEL_METRICS_ENABLED");
    const veryfrontOtel = envAdapter.get("VERYFRONT_OTEL");

    finalConfig.enabled = otelEnabled === "true" ||
      veryfrontOtel === "1" ||
      finalConfig.enabled;

    const otlpEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_ENDPOINT");
    const metricsEndpoint = envAdapter.get(
      "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    );
    finalConfig.endpoint = otlpEndpoint || metricsEndpoint ||
      finalConfig.endpoint;

    const exporterType = envAdapter.get("OTEL_METRICS_EXPORTER");
    if (
      exporterType === "prometheus" || exporterType === "otlp" ||
      exporterType === "console"
    ) {
      finalConfig.exporter = exporterType;
    }
  } else {
    try {
      finalConfig.enabled = getEnv("OTEL_METRICS_ENABLED") === "true" ||
        getEnv("VERYFRONT_OTEL") === "1" ||
        finalConfig.enabled;
      finalConfig.endpoint = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") ||
        getEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ||
        finalConfig.endpoint;
      const exporterType = getEnv("OTEL_METRICS_EXPORTER");
      if (
        exporterType === "prometheus" || exporterType === "otlp" ||
        exporterType === "console"
      ) {
        finalConfig.exporter = exporterType;
      }
    } catch {
    }
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
