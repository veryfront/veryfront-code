import type { MetricsConfig } from "./types.ts";
import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { memoryUsage as platformMemoryUsage } from "#veryfront/platform/compat/process.ts";
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";

const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;
const MAX_METRICS_COLLECT_INTERVAL_MS = 86_400_000;

export const DEFAULT_CONFIG: MetricsConfig = {
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  debug: false,
};

function getEnvVar(env: unknown, key: string): string | undefined {
  if (env == null || typeof env !== "object") return undefined;

  const envObj = env as Record<string, unknown>;
  try {
    if (typeof envObj.get === "function") {
      const value = envObj.get(key);
      return typeof value === "string" ? value : undefined;
    }

    const value = envObj[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isValidExporter(
  exporter: unknown,
): exporter is "prometheus" | "otlp" | "console" {
  return exporter === "prometheus" || exporter === "otlp" || exporter === "console";
}

export function loadConfig(
  config: Partial<MetricsConfig> = {},
  adapter?: ObservabilityRuntimeAdapter,
): MetricsConfig {
  const finalConfig = normalizeConfig(config);

  function applyEnvConfig(opts: {
    enabledFlag?: string;
    veryfrontFlag?: string;
    endpoint?: string;
    metricsEndpoint?: string;
    exporter?: unknown;
  }): void {
    finalConfig.enabled = opts.enabledFlag === "true" || opts.veryfrontFlag === "1" ||
      finalConfig.enabled;

    finalConfig.endpoint = opts.metricsEndpoint || opts.endpoint || finalConfig.endpoint;

    if (isValidExporter(opts.exporter)) {
      finalConfig.exporter = opts.exporter;
    }
  }

  const env = adapter?.env;
  if (env) {
    applyEnvConfig({
      enabledFlag: getEnvVar(env, "OTEL_METRICS_ENABLED"),
      veryfrontFlag: getEnvVar(env, "VERYFRONT_OTEL"),
      endpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      metricsEndpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
      exporter: getEnvVar(env, "OTEL_METRICS_EXPORTER"),
    });
    return normalizeConfig(finalConfig);
  }

  try {
    applyEnvConfig({
      enabledFlag: getHostTelemetryEnv("OTEL_METRICS_ENABLED"),
      veryfrontFlag: getHostTelemetryEnv("VERYFRONT_OTEL"),
      endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
      metricsEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
      exporter: getHostTelemetryEnv("OTEL_METRICS_EXPORTER"),
    });
  } catch (_) {
    /* expected: getEnv access may fail in some runtimes */
  }

  return normalizeConfig(finalConfig);
}

function normalizeConfig(config: Partial<MetricsConfig>): MetricsConfig {
  const source = config && typeof config === "object" ? config : {};
  const prefix = typeof source.prefix === "string" &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,62}$/.test(source.prefix)
    ? source.prefix
    : DEFAULT_CONFIG.prefix;
  const endpoint = typeof source.endpoint === "string" &&
      source.endpoint.length > 0 && source.endpoint.length <= 2_048 &&
      !/[\r\n]/.test(source.endpoint)
    ? source.endpoint
    : undefined;
  const collectInterval = typeof source.collectInterval === "number" &&
      Number.isSafeInteger(source.collectInterval) && source.collectInterval > 0 &&
      source.collectInterval <= MAX_METRICS_COLLECT_INTERVAL_MS
    ? source.collectInterval
    : DEFAULT_CONFIG.collectInterval;

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
    exporter: isValidExporter(source.exporter) ? source.exporter : DEFAULT_CONFIG.exporter,
    prefix,
    collectInterval,
    debug: typeof source.debug === "boolean" ? source.debug : DEFAULT_CONFIG.debug,
    ...(endpoint ? { endpoint } : {}),
  };
}

export function getMemoryUsage(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
} | null {
  try {
    return platformMemoryUsage();
  } catch (_) {
    /* expected: memory usage API may be unavailable on some platforms */
    return null;
  }
}
