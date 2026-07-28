import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getOtelTracingConfig } from "#veryfront/config/env.ts";
import type { TracingConfig } from "./types.ts";
import { MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH, MAX_OBSERVABILITY_NAME_LENGTH } from "../limits.ts";

export const DEFAULT_CONFIG: Readonly<TracingConfig> = Object.freeze({
  enabled: false,
  exporter: "console",
  serviceName: "veryfront",
  sampleRate: 1.0,
  debug: false,
});

export function loadConfig(
  config: Partial<TracingConfig> = {},
  adapter?: RuntimeAdapter,
): TracingConfig {
  const finalConfig = normalizeConfig(config);

  const envAdapter = adapter?.env;
  if (envAdapter) {
    applyEnvFromAdapter(finalConfig, envAdapter);
    return finalConfig;
  }

  applyEnvFromDeno(finalConfig);
  return finalConfig;
}

function applyEnvFromAdapter(
  config: TracingConfig,
  envAdapter: RuntimeAdapter["env"],
): void {
  try {
    applyEnvValues(config, {
      enabledFlag: envAdapter.get("OTEL_TRACES_ENABLED"),
      veryfrontFlag: envAdapter.get("VERYFRONT_OTEL"),
      serviceName: envAdapter.get("OTEL_SERVICE_NAME"),
      endpoint: envAdapter.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
      signalEndpoint: envAdapter.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
      exporter: envAdapter.get("OTEL_TRACES_EXPORTER"),
    });
  } catch {
    // An explicit adapter owns this environment boundary. If it is
    // unavailable, preserve caller configuration rather than consulting a
    // different host environment.
  }
}

function applyEnvFromDeno(config: TracingConfig): void {
  try {
    const tracingConfig = getOtelTracingConfig();
    applyEnvValues(config, {
      enabledFlag: tracingConfig.enabledFlag,
      veryfrontFlag: tracingConfig.veryfrontFlag,
      serviceName: tracingConfig.serviceName,
      endpoint: tracingConfig.endpoint,
      signalEndpoint: tracingConfig.tracesEndpoint,
      exporter: tracingConfig.exporter,
    });
  } catch (_) {
    /* expected: environment access may fail in some runtimes */
  }
}

function normalizeConfig(config: Partial<TracingConfig>): TracingConfig {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Tracing config must be an object");
  }
  const raw = config as Record<string, unknown>;
  const enabled = raw.enabled ?? DEFAULT_CONFIG.enabled;
  if (typeof enabled !== "boolean") {
    throw new TypeError("Tracing enabled must be a boolean");
  }
  const exporter = raw.exporter ?? DEFAULT_CONFIG.exporter;
  if (!isValidExporter(exporter)) {
    throw new TypeError("Tracing exporter is invalid");
  }
  const serviceName = requireOptionalText(
    raw.serviceName ?? DEFAULT_CONFIG.serviceName,
    "serviceName",
    MAX_OBSERVABILITY_NAME_LENGTH,
  );
  const endpoint = raw.endpoint === undefined ? undefined : requireOptionalText(
    raw.endpoint,
    "endpoint",
    MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  );
  const sampleRate = raw.sampleRate ?? DEFAULT_CONFIG.sampleRate;
  if (
    typeof sampleRate !== "number" || !Number.isFinite(sampleRate) ||
    sampleRate < 0 || sampleRate > 1
  ) {
    throw new RangeError("Tracing sampleRate must be a finite number between 0 and 1");
  }
  const debug = raw.debug ?? DEFAULT_CONFIG.debug;
  if (typeof debug !== "boolean") {
    throw new TypeError("Tracing debug must be a boolean");
  }

  return {
    enabled,
    exporter,
    serviceName,
    sampleRate,
    debug,
    ...(endpoint ? { endpoint } : {}),
  };
}

function applyEnvValues(
  config: TracingConfig,
  values: {
    enabledFlag?: unknown;
    veryfrontFlag?: unknown;
    serviceName?: unknown;
    endpoint?: unknown;
    signalEndpoint?: unknown;
    exporter?: unknown;
  },
): void {
  config.enabled = isTrueEnvironmentValue(values.enabledFlag) ||
    values.veryfrontFlag === "1" || config.enabled;

  const serviceName = normalizeEnvironmentText(
    values.serviceName,
    MAX_OBSERVABILITY_NAME_LENGTH,
  );
  if (serviceName) config.serviceName = serviceName;

  const signalEndpoint = normalizeEnvironmentText(
    values.signalEndpoint,
    MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  );
  const endpoint = normalizeEnvironmentText(
    values.endpoint,
    MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  );
  config.endpoint = signalEndpoint || endpoint || config.endpoint;

  const exporter = typeof values.exporter === "string"
    ? values.exporter.trim().toLowerCase()
    : undefined;
  if (isValidExporter(exporter)) config.exporter = exporter;
}

function isTrueEnvironmentValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function requireOptionalText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`Tracing ${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(
      `Tracing ${name} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function normalizeEnvironmentText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function isValidExporter(
  value: unknown,
): value is TracingConfig["exporter"] {
  return (
    value === "jaeger" ||
    value === "zipkin" ||
    value === "otlp" ||
    value === "console"
  );
}
