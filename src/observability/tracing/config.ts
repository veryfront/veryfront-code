import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { TracingConfig } from "./types.ts";
import { getEnv } from "../../platform/compat/process.ts";

const DEFAULT_CONFIG: TracingConfig = {
  enabled: false,
  exporter: "console",
  serviceName: "veryfront",
  sampleRate: 1.0,
  debug: false,
};

export function loadConfig(
  config: Partial<TracingConfig> = {},
  adapter?: RuntimeAdapter,
): TracingConfig {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (adapter?.env) {
    applyEnvFromAdapter(finalConfig, adapter.env);
  } else {
    applyEnvFromDeno(finalConfig);
  }

  return finalConfig;
}

function applyEnvFromAdapter(
  config: TracingConfig,
  envAdapter: RuntimeAdapter["env"],
): void {
  if (!envAdapter) return;

  const otelEnabled = envAdapter.get("OTEL_TRACES_ENABLED");
  const veryfrontOtel = envAdapter.get("VERYFRONT_OTEL");
  const serviceName = envAdapter.get("OTEL_SERVICE_NAME");

  config.enabled = otelEnabled === "true" ||
    veryfrontOtel === "1" ||
    config.enabled;

  if (serviceName) config.serviceName = serviceName;

  const otlpEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  config.endpoint = otlpEndpoint || tracesEndpoint || config.endpoint;

  const exporterType = envAdapter.get("OTEL_TRACES_EXPORTER");
  if (isValidExporter(exporterType)) {
    config.exporter = exporterType;
  }
}

function applyEnvFromDeno(config: TracingConfig): void {
  try {
    // Use platform abstraction for cross-platform env access
    config.enabled = getEnv("OTEL_TRACES_ENABLED") === "true" ||
      getEnv("VERYFRONT_OTEL") === "1" ||
      config.enabled;

    config.serviceName = getEnv("OTEL_SERVICE_NAME") || config.serviceName;
    config.endpoint = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") ||
      getEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ||
      config.endpoint;

    const exporterType = getEnv("OTEL_TRACES_EXPORTER");
    if (isValidExporter(exporterType)) {
      config.exporter = exporterType;
    }
  } catch {
    // Environment access may fail in some runtimes
  }
}

function isValidExporter(value: string | undefined): value is TracingConfig["exporter"] {
  return value === "jaeger" || value === "zipkin" || value === "otlp" || value === "console";
}
