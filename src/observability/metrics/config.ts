import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { MetricsConfig } from "./types.ts";
import { memoryUsage as platformMemoryUsage } from "#veryfront/platform/compat/process/lifecycle.ts";
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH, MAX_OBSERVABILITY_NAME_LENGTH } from "../limits.ts";

const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;

export const DEFAULT_CONFIG: Readonly<MetricsConfig> = Object.freeze({
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  debug: false,
});

function isValidExporter(
  exporter: unknown,
): exporter is "prometheus" | "otlp" | "console" {
  return exporter === "prometheus" || exporter === "otlp" || exporter === "console";
}

export function loadConfig(
  config: Partial<MetricsConfig>,
  adapter?: RuntimeAdapter,
): MetricsConfig {
  const finalConfig = normalizeConfig(config);

  const env = adapter?.env;
  if (env) {
    try {
      applyEnvConfig(finalConfig, {
        enabledFlag: env.get("OTEL_METRICS_ENABLED"),
        veryfrontFlag: env.get("VERYFRONT_OTEL"),
        endpoint: env.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
        metricsEndpoint: env.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
        exporter: env.get("OTEL_METRICS_EXPORTER"),
      });
    } catch {
      // Preserve caller configuration when the explicit adapter environment
      // is unavailable; do not cross into the host environment.
    }
    return finalConfig;
  }

  try {
    applyEnvConfig(finalConfig, {
      enabledFlag: getHostTelemetryEnv("OTEL_METRICS_ENABLED"),
      veryfrontFlag: getHostTelemetryEnv("VERYFRONT_OTEL"),
      endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
      metricsEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
      exporter: getHostTelemetryEnv("OTEL_METRICS_EXPORTER"),
    });
  } catch (_) {
    /* expected: getEnv access may fail in some runtimes */
  }

  return finalConfig;
}

function normalizeConfig(config: Partial<MetricsConfig>): MetricsConfig {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Metrics config must be an object");
  }
  const raw = config as Record<string, unknown>;
  const enabled = raw.enabled ?? DEFAULT_CONFIG.enabled;
  if (typeof enabled !== "boolean") {
    throw new TypeError("Metrics enabled must be a boolean");
  }
  const exporter = raw.exporter ?? DEFAULT_CONFIG.exporter;
  if (!isValidExporter(exporter)) {
    throw new TypeError("Metrics exporter is invalid");
  }
  const prefix = requireText(
    raw.prefix ?? DEFAULT_CONFIG.prefix,
    "prefix",
    MAX_OBSERVABILITY_NAME_LENGTH,
  );
  const endpoint = raw.endpoint === undefined ? undefined : requireText(
    raw.endpoint,
    "endpoint",
    MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  );
  const collectInterval = raw.collectInterval ?? DEFAULT_CONFIG.collectInterval;
  if (
    !Number.isSafeInteger(collectInterval) || (collectInterval as number) <= 0 ||
    (collectInterval as number) > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Metrics collectInterval must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  const debug = raw.debug ?? DEFAULT_CONFIG.debug;
  if (typeof debug !== "boolean") {
    throw new TypeError("Metrics debug must be a boolean");
  }

  return {
    enabled,
    exporter,
    prefix,
    collectInterval: collectInterval as number,
    debug,
    ...(endpoint ? { endpoint } : {}),
  };
}

function applyEnvConfig(
  config: MetricsConfig,
  values: {
    enabledFlag?: unknown;
    veryfrontFlag?: unknown;
    endpoint?: unknown;
    metricsEndpoint?: unknown;
    exporter?: unknown;
  },
): void {
  config.enabled = isTrueEnvironmentValue(values.enabledFlag) ||
    values.veryfrontFlag === "1" || config.enabled;

  const signalEndpoint = normalizeEnvironmentText(
    values.metricsEndpoint,
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

function requireText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`Metrics ${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(
      `Metrics ${name} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function normalizeEnvironmentText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
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
