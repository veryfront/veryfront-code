import { getOtelTracingConfig } from "#veryfront/config/env.ts";
import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import type { TracingConfig } from "./types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const DEFAULT_CONFIG: TracingConfig = {
  enabled: false,
  exporter: "console",
  serviceName: "veryfront",
  sampleRate: 1.0,
  debug: false,
};

export function loadConfig(
  config: Partial<TracingConfig> = {},
  adapter?: ObservabilityRuntimeAdapter,
): TracingConfig {
  const finalConfig = normalizeConfig(config);

  const envAdapter = adapter?.env;
  if (envAdapter) {
    applyEnvFromAdapter(finalConfig, envAdapter);
    return normalizeConfig(finalConfig);
  }

  applyEnvFromDeno(finalConfig);
  return normalizeConfig(finalConfig);
}

function normalizeConfig(config: Partial<TracingConfig>): TracingConfig {
  const source = config && typeof config === "object" ? config : {};
  const rawServiceName = typeof source.serviceName === "string" ? source.serviceName.trim() : "";
  const serviceName = rawServiceName.length > 0 && rawServiceName.length <= 128 &&
      !hasUnsafeControlCharacters(rawServiceName)
    ? rawServiceName
    : DEFAULT_CONFIG.serviceName;
  const endpoint = typeof source.endpoint === "string" &&
      source.endpoint.length > 0 && source.endpoint.length <= 2_048 &&
      !/[\r\n]/.test(source.endpoint)
    ? source.endpoint
    : undefined;

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
    exporter: isValidExporter(source.exporter) ? source.exporter : DEFAULT_CONFIG.exporter,
    serviceName,
    sampleRate: typeof source.sampleRate === "number" && Number.isFinite(source.sampleRate) &&
        source.sampleRate >= 0 && source.sampleRate <= 1
      ? source.sampleRate
      : DEFAULT_CONFIG.sampleRate,
    debug: typeof source.debug === "boolean" ? source.debug : DEFAULT_CONFIG.debug,
    ...(endpoint ? { endpoint } : {}),
  };
}

function applyEnvFromAdapter(
  config: TracingConfig,
  envAdapter: ObservabilityRuntimeAdapter["env"],
): void {
  const read = (key: string): string | undefined => {
    try {
      return envAdapter.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  };

  config.enabled = read("OTEL_TRACES_ENABLED") === "true" ||
    read("VERYFRONT_OTEL") === "1" ||
    config.enabled;

  config.serviceName = read("OTEL_SERVICE_NAME") ?? config.serviceName;

  config.endpoint = read("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ??
    read("OTEL_EXPORTER_OTLP_ENDPOINT") ??
    config.endpoint;

  const exporterType = read("OTEL_TRACES_EXPORTER");
  if (isValidExporter(exporterType)) config.exporter = exporterType;
}

function applyEnvFromDeno(config: TracingConfig): void {
  try {
    const tracingConfig = getOtelTracingConfig();

    config.enabled = tracingConfig.enabledFlag === "true" ||
      tracingConfig.veryfrontFlag === "1" ||
      config.enabled;

    config.serviceName = tracingConfig.serviceName ?? config.serviceName;

    config.endpoint = tracingConfig.tracesEndpoint ??
      tracingConfig.endpoint ??
      config.endpoint;

    const exporterType = tracingConfig.exporter;
    if (isValidExporter(exporterType)) config.exporter = exporterType;
  } catch (_) {
    /* expected: environment access may fail in some runtimes */
  }
}

function isValidExporter(
  value: string | undefined,
): value is TracingConfig["exporter"] {
  return (
    value === "jaeger" ||
    value === "zipkin" ||
    value === "otlp" ||
    value === "console"
  );
}
