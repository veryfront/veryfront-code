import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { TracingConfig } from "./types.ts";
import { getOtelTracingConfig } from "@veryfront/core/config/env.ts";

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
    const tracingConfig = getOtelTracingConfig();
    config.enabled = tracingConfig.enabledFlag === "true" ||
      tracingConfig.veryfrontFlag === "1" ||
      config.enabled;

    config.serviceName = tracingConfig.serviceName || config.serviceName;
    config.endpoint = tracingConfig.endpoint || tracingConfig.tracesEndpoint || config.endpoint;

    const exporterType = tracingConfig.exporter;
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
