/**
 * Runtime/application metric hooks for project code.
 *
 * @module metrics
 *
 * @example
 * ```ts
 * import { metrics } from "veryfront/metrics";
 *
 * metrics.counter("vf_eval_result_total", 1, { provider: "openai" });
 * metrics.histogram("vf_eval_latency_ms", 420, { model: "gpt-5" });
 * metrics.gauge("vf_eval_queue_depth", 3);
 * ```
 */

import {
  type AttributeValue,
  type Counter,
  getGlobalMetricsAPI,
  type Histogram,
} from "#veryfront/observability";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { encodeBase64 } from "#veryfront/utils";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { isProjectEnvActive } from "#veryfront/server/project-env/storage.ts";
import { getMetricsApiRevision } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type DirectMetricInstrumentOptions,
  type DirectMetricKind,
  type DirectMetricsTarget,
  type DirectMetricTemporality,
} from "./direct-exporter.ts";
import { logMetricFailure } from "./diagnostics.ts";
import {
  type LocalGaugeSample,
  type LocalGaugeState,
  metricsRuntimeState,
} from "./runtime-state.ts";

/**
 * Primitive value accepted for a metric attribute.
 *
 * Nullish values and invalid strings or numbers are omitted from the
 * measurement.
 */
export type MetricAttributeValue = string | number | boolean | null | undefined;

/**
 * Low-cardinality attributes attached to one metric measurement.
 *
 * A measurement accepts at most 16 user attributes. Attribute keys are at
 * most 128 characters, string values are at most 256 characters, and numeric
 * values must be finite. Platform-owned project and environment attributes
 * are added separately and override user-provided values with the same keys.
 */
export type MetricAttributes = Record<string, MetricAttributeValue>;

/**
 * Stable OpenTelemetry metadata for a metric instrument.
 *
 * Description and unit values must be non-empty, control-character-free
 * strings no longer than 256 characters. Reuse the same metadata for a metric
 * kind and name.
 */
export interface MetricInstrumentOptions {
  /** Human-readable description of the measurement. */
  description?: string;
  /** OpenTelemetry unit annotation, such as `ms`, `s`, `By`, or `1`. */
  unit?: string;
}

const {
  counters,
  directExporter,
  gauges,
  histograms,
} = metricsRuntimeState;

const METRIC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.\/-]{0,254}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_ATTRIBUTE_STRING_LENGTH = 256;
const MAX_ATTRIBUTE_ENTRIES_INSPECTED = 64;
const MAX_USER_ATTRIBUTES = 16;
const MAX_INSTRUMENT_OPTION_LENGTH = 256;
const MAX_INSTRUMENTS_PER_KIND = 1_000;
const MAX_GAUGE_SERIES_PER_INSTRUMENT = 1_000;
const MAX_GAUGE_SERIES_TOTAL = 10_000;
const MAX_HEADER_INPUT_LENGTH = 8_192;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 1_024;
const MAX_ENDPOINT_LENGTH = 2_048;

function getMeter() {
  return getGlobalMetricsAPI()?.getMeter("veryfront.project.metrics");
}

function refreshLocalProviderState(): void {
  metricsRuntimeState.refreshLocalProvider(getMetricsApiRevision());
}

function isValidMetricName(name: unknown): name is string {
  return typeof name === "string" && METRIC_NAME_PATTERN.test(name);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function containsUnsafeHeaderCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || code === 10 || code === 13) return true;
  }
  return false;
}

function normalizeInstrumentOptions(
  options?: MetricInstrumentOptions,
): DirectMetricInstrumentOptions | null {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object")
  ) {
    return null;
  }
  const normalized: DirectMetricInstrumentOptions = {};
  for (const key of ["description", "unit"] as const) {
    const value = options?.[key];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_INSTRUMENT_OPTION_LENGTH ||
      containsControlCharacter(value)
    ) {
      return null;
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeAttributeValue(value: unknown): AttributeValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (
    typeof value === "string" &&
    value.length <= MAX_ATTRIBUTE_STRING_LENGTH &&
    !containsControlCharacter(value)
  ) {
    return value;
  }
  return undefined;
}

function setNormalizedAttribute(
  target: Record<string, AttributeValue>,
  key: unknown,
  value: unknown,
): boolean {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_ATTRIBUTE_KEY_LENGTH ||
    containsControlCharacter(key)
  ) {
    return false;
  }
  const normalizedValue = normalizeAttributeValue(value);
  if (normalizedValue === undefined) return false;
  target[key] = normalizedValue;
  return true;
}

function normalizeAttributes(
  attributes?: MetricAttributes,
): Readonly<Record<string, AttributeValue>> {
  const normalized = Object.create(null) as Record<string, AttributeValue>;
  if (attributes && typeof attributes === "object") {
    let accepted = 0;
    let inspected = 0;
    for (const key in attributes) {
      if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
      inspected++;
      if (inspected > MAX_ATTRIBUTE_ENTRIES_INSPECTED || accepted >= MAX_USER_ATTRIBUTES) break;
      if (setNormalizedAttribute(normalized, key, attributes[key])) accepted++;
    }
  }

  const context = getCurrentRequestContext();
  if (context?.projectId) setNormalizedAttribute(normalized, "project_id", context.projectId);
  if (context?.projectSlug) setNormalizedAttribute(normalized, "project_slug", context.projectSlug);
  if (context) {
    const environmentName = context.environmentName ??
      (!context.productionMode ? "preview" : undefined);
    if (environmentName) setNormalizedAttribute(normalized, "environment", environmentName);
    if (!context.productionMode) {
      setNormalizedAttribute(normalized, "branch", context.branch ?? "main");
    }
  }

  return Object.freeze(normalized);
}

function attributesKey(attributes: Readonly<Record<string, AttributeValue>>): string {
  return JSON.stringify(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  );
}

function instrumentKey(
  name: string,
  options: DirectMetricInstrumentOptions,
): string {
  return JSON.stringify([name, options.description ?? "", options.unit ?? ""]);
}

function getCounter(
  name: string,
  options: DirectMetricInstrumentOptions,
): Counter | null {
  refreshLocalProviderState();
  const key = instrumentKey(name, options);
  const cached = counters.get(key);
  if (cached) return cached;
  if (counters.size >= MAX_INSTRUMENTS_PER_KIND) {
    logMetricFailure("counter instrument cardinality limit reached");
    return null;
  }

  const meter = getMeter();
  if (!meter) return null;

  const counter = meter.createCounter(name, options);
  counters.set(key, counter);
  return counter;
}

function getHistogram(
  name: string,
  options: DirectMetricInstrumentOptions,
): Histogram | null {
  refreshLocalProviderState();
  const key = instrumentKey(name, options);
  const cached = histograms.get(key);
  if (cached) return cached;
  if (histograms.size >= MAX_INSTRUMENTS_PER_KIND) {
    logMetricFailure("histogram instrument cardinality limit reached");
    return null;
  }

  const meter = getMeter();
  if (!meter) return null;

  const histogram = meter.createHistogram(name, options);
  histograms.set(key, histogram);
  return histogram;
}

function getGauge(
  name: string,
  options: DirectMetricInstrumentOptions,
) {
  refreshLocalProviderState();
  const key = instrumentKey(name, options);
  const cached = gauges.get(key);
  if (cached) return cached;
  if (gauges.size >= MAX_INSTRUMENTS_PER_KIND) {
    logMetricFailure("gauge instrument cardinality limit reached");
    return null;
  }

  const meter = getMeter();
  if (!meter) return null;

  const samples = new Map<string, LocalGaugeSample>();
  const instrument = meter.createObservableGauge(name, options);
  const callback: LocalGaugeState["callback"] = (result) => {
    for (const sample of samples.values()) {
      try {
        result.observe(sample.value, sample.attributes);
      } catch (error) {
        logMetricFailure("observable gauge callback failed", error);
      }
    }
  };
  instrument.addCallback(callback);

  const gauge = { callback, instrument, samples };
  gauges.set(key, gauge);
  return gauge;
}

function readEnv(name: string): string | undefined {
  return getEnv(name);
}

function readHostEnv(name: string): string | undefined {
  return getHostEnv(name);
}

function readProjectEnv(name: string): string | undefined {
  return isProjectEnvActive() ? getEnv(name) : undefined;
}

function isDedicatedRuntime(): boolean {
  return Boolean(readHostEnv("SERVER_ID") && readHostEnv("ENVIRONMENT_IDS"));
}

function normalizeEndpoint(
  endpoint: string | undefined,
  suffix: string,
): string | null {
  if (!endpoint) return null;
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.length === 0 || trimmed.length > MAX_ENDPOINT_LENGTH) return null;
  const candidate = trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
  if (candidate.length > MAX_ENDPOINT_LENGTH) return null;

  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveProjectOtlpMetricsUrl(): string | null {
  if (!isTruthyEnvValue(readProjectEnv("OTEL_METRICS_ENABLED"))) return null;
  const endpoint = readProjectEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    readProjectEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  return normalizeEndpoint(endpoint, "/v1/metrics");
}

function resolveOtlpMetricsUrl(): string | null {
  if (!isTruthyEnvValue(readEnv("OTEL_METRICS_ENABLED"))) return null;
  const endpoint = readEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    readEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  return normalizeEndpoint(endpoint, "/v1/metrics");
}

function resolveInternalMetricsUrl(): string | null {
  if (!isTruthyEnvValue(readHostEnv("OTEL_METRICS_ENABLED"))) return null;
  const apiBaseUrl = readHostEnv("VERYFRONT_API_BASE_URL") ?? readHostEnv("VERYFRONT_API_URL");
  return normalizeEndpoint(apiBaseUrl, "/internal/metrics/otlp/v1/metrics");
}

function buildBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  return `Basic ${encodeBase64(credentials)}`;
}

function isValidHeaderValue(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_HEADER_VALUE_LENGTH &&
    !containsUnsafeHeaderCharacter(value);
}

function parseHeaders(
  headerInput: string | undefined,
): Readonly<Record<string, string>> | null {
  if (!headerInput) return Object.freeze({});
  if (headerInput.length > MAX_HEADER_INPUT_LENGTH) return null;
  if (headerInput.startsWith("Basic ")) {
    return isValidHeaderValue(headerInput) ? Object.freeze({ Authorization: headerInput }) : null;
  }
  if (headerInput.startsWith("Authorization=")) {
    const value = headerInput.slice("Authorization=".length);
    return isValidHeaderValue(value) ? Object.freeze({ Authorization: value }) : null;
  }

  const result = Object.create(null) as Record<string, string>;
  const seen = new Set<string>();
  let count = 0;
  for (const part of headerInput.split(",")) {
    const [key, ...valueParts] = part.split("=");
    const normalizedKey = key?.trim();
    const value = valueParts.join("=").trim();
    const comparisonKey = normalizedKey?.toLowerCase();
    if (
      !normalizedKey ||
      valueParts.length === 0 ||
      normalizedKey.length > MAX_ATTRIBUTE_KEY_LENGTH ||
      !HEADER_NAME_PATTERN.test(normalizedKey) ||
      !isValidHeaderValue(value) ||
      !comparisonKey ||
      seen.has(comparisonKey)
    ) {
      return null;
    }
    count++;
    if (count > MAX_HEADER_COUNT) return null;
    seen.add(comparisonKey);
    result[normalizedKey] = value;
  }
  return Object.freeze(result);
}

function resolveResourceAttribute(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = normalizeAttributeValue(value);
  return typeof normalized === "string" ? normalized : fallback;
}

function resolveDirectMetricTemporality(): DirectMetricTemporality {
  const preference = readEnv(
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE",
  )?.toLowerCase();
  return preference === "delta" || preference === "lowmemory" ? "delta" : "cumulative";
}

function createDirectMetricsTarget(
  url: string,
  headers: Readonly<Record<string, string>>,
): DirectMetricsTarget {
  return {
    url,
    headers,
    resourceAttributes: Object.freeze({
      "service.name": resolveResourceAttribute(
        readEnv("OTEL_SERVICE_NAME"),
        "veryfront",
      ),
      "service.version": resolveResourceAttribute(
        readEnv("VERYFRONT_VERSION") ?? readEnv("RELEASE_VERSION"),
        RUNTIME_VERSION,
      ),
    }),
    temporality: resolveDirectMetricTemporality(),
  };
}

function resolveDirectMetricsTarget(): DirectMetricsTarget | null {
  const projectOtlpUrl = resolveProjectOtlpMetricsUrl();
  if (isDedicatedRuntime() && projectOtlpUrl) {
    const headers = parseHeaders(
      readProjectEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") ??
        readProjectEnv("OTEL_EXPORTER_OTLP_HEADERS"),
    );
    return headers ? createDirectMetricsTarget(projectOtlpUrl, headers) : null;
  }

  const internalUrl = resolveInternalMetricsUrl();
  if (internalUrl) {
    const username = readHostEnv("VERYFRONT_API_INTERNAL_USER");
    const password = readHostEnv("VERYFRONT_API_INTERNAL_PASS");
    if (
      !username ||
      !password ||
      username.length > MAX_ATTRIBUTE_STRING_LENGTH ||
      password.length > MAX_ATTRIBUTE_STRING_LENGTH
    ) {
      return null;
    }
    const authorization = buildBasicAuth(username, password);
    if (!isValidHeaderValue(authorization)) return null;
    return createDirectMetricsTarget(
      internalUrl,
      Object.freeze({ Authorization: authorization }),
    );
  }

  const otlpUrl = resolveOtlpMetricsUrl();
  if (!otlpUrl) return null;
  const headers = parseHeaders(
    readEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") ??
      readEnv("OTEL_EXPORTER_OTLP_HEADERS"),
  );
  return headers ? createDirectMetricsTarget(otlpUrl, headers) : null;
}

function getUnixNanoTimestamp(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

function runMetricOperation(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    logMetricFailure("provider operation failed", error);
  }
}

function logDirectExportFailure(message: string, error?: unknown): void {
  try {
    serverLogger.debug(
      `metrics: direct OTLP export failed: ${message}`,
      error instanceof Error ? error : { reason: String(error) },
    );
  } catch {
    // Telemetry diagnostics must never affect application execution.
  }
}

function enqueueDirectMetric(
  kind: DirectMetricKind,
  name: string,
  value: number,
  attributes: Readonly<Record<string, AttributeValue>>,
  options: DirectMetricInstrumentOptions,
  target: DirectMetricsTarget,
): void {
  directExporter.record({
    kind,
    name,
    value,
    attributes,
    options,
    timestampUnixNano: getUnixNanoTimestamp(),
    target,
  });
}

function recordMetric(
  kind: DirectMetricKind,
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  runMetricOperation(() => {
    if (!isValidMetricName(name)) {
      logMetricFailure("invalid metric name");
      return;
    }
    if (!Number.isFinite(value) || (kind === "counter" && value < 0)) {
      logMetricFailure("invalid metric value");
      return;
    }

    const normalizedOptions = normalizeInstrumentOptions(options);
    if (!normalizedOptions) {
      logMetricFailure("invalid instrument options");
      return;
    }
    const normalizedAttributes = normalizeAttributes(attributes);
    const directTarget = resolveDirectMetricsTarget();
    if (directTarget) {
      enqueueDirectMetric(
        kind,
        name,
        value,
        normalizedAttributes,
        normalizedOptions,
        directTarget,
      );
      return;
    }

    if (kind === "counter") {
      getCounter(name, normalizedOptions)?.add(value, normalizedAttributes);
      return;
    }
    if (kind === "histogram") {
      getHistogram(name, normalizedOptions)?.record(value, normalizedAttributes);
      return;
    }

    const gauge = getGauge(name, normalizedOptions);
    if (!gauge) return;
    const key = attributesKey(normalizedAttributes);
    if (!gauge.samples.has(key)) {
      if (
        gauge.samples.size >= MAX_GAUGE_SERIES_PER_INSTRUMENT ||
        metricsRuntimeState.gaugeSeriesCount >= MAX_GAUGE_SERIES_TOTAL
      ) {
        logMetricFailure("gauge series cardinality limit reached");
        return;
      }
      metricsRuntimeState.gaugeSeriesCount++;
    }
    gauge.samples.set(key, {
      value,
      attributes: normalizedAttributes,
    });
  });
}

/**
 * Add a non-negative finite value to a monotonic project counter.
 *
 * Names must begin with a letter, contain only letters, digits, `_`, `.`, `/`,
 * or `-`, and be at most 255 characters. Invalid or over-budget measurements
 * are dropped without throwing into application code.
 */
export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  recordMetric("counter", name, value, attributes, options);
}

/**
 * Record one finite value in a project histogram.
 *
 * Names must begin with a letter, contain only letters, digits, `_`, `.`, `/`,
 * or `-`, and be at most 255 characters. Invalid or over-budget measurements
 * are dropped without throwing into application code.
 */
export function histogram(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  recordMetric("histogram", name, value, attributes, options);
}

/**
 * Set the latest finite value for a project gauge series.
 *
 * Names must begin with a letter, contain only letters, digits, `_`, `.`, `/`,
 * or `-`, and be at most 255 characters. Invalid or over-budget measurements
 * are dropped without throwing into application code.
 */
export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  recordMetric("gauge", name, value, attributes, options);
}

/**
 * Attempt to flush pending direct OTLP project metrics.
 *
 * The promise always resolves, including when a collector is unavailable.
 * This does not force-flush an externally installed OpenTelemetry meter
 * provider.
 */
export async function flushMetrics(): Promise<void> {
  try {
    await directExporter.flush();
  } catch (error) {
    logDirectExportFailure("flush failed", error);
  }
}

/**
 * Immutable project metric hooks and direct-export lifecycle control.
 *
 * Measurements and flushes are failure-isolated from application code.
 */
export const metrics = Object.freeze({
  counter,
  histogram,
  gauge,
  flush: flushMetrics,
});
