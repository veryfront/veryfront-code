/**
 * Runtime and application metric hooks for project code.
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

import type { AttributeValue } from "#veryfront/observability";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { enqueueDirectMetric } from "./direct-exporter.ts";
import { registerMetricInstrument } from "./instrument-definitions.ts";
import { recordSdkCounter, recordSdkGauge, recordSdkHistogram } from "./instrument-registry.ts";

/** A scalar value accepted as a metric attribute. Nullish values are omitted. */
export type MetricAttributeValue = string | number | boolean | null | undefined;

/** Low-cardinality attributes attached to a metric measurement. */
export type MetricAttributes = Record<string, MetricAttributeValue>;

/** Descriptive metadata for a metric instrument. */
export interface MetricInstrumentOptions {
  /** A concise description of what the instrument measures. */
  description?: string;
  /** The UCUM unit for recorded values, such as `ms`, `s`, or `By`. */
  unit?: string;
}

const METRIC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.\/-]{0,254}$/;
const MAX_METRIC_DESCRIPTION_LENGTH = 1_024;
const MAX_METRIC_UNIT_LENGTH = 255;
const MAX_METRIC_ATTRIBUTES = 128;
const MAX_ATTRIBUTE_KEY_BYTES = 255;
const MAX_ATTRIBUTE_STRING_BYTES = 4_096;
const MAX_ATTRIBUTE_DATA_BYTES = 16_384;
const textEncoder = new TextEncoder();

function setAttribute(
  target: Record<string, AttributeValue>,
  key: string,
  value: AttributeValue,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function normalizeAttributes(attributes?: MetricAttributes): Record<string, AttributeValue> {
  if (
    attributes !== undefined &&
    (typeof attributes !== "object" || attributes === null || Array.isArray(attributes))
  ) {
    throw new TypeError("Metric attributes must be a record");
  }

  const normalized: Record<string, AttributeValue> = {};
  const entries = Object.entries(attributes ?? {});
  let attributeCount = 0;
  let attributeBytes = 0;
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    attributeCount += 1;
    if (attributeCount > MAX_METRIC_ATTRIBUTES) {
      throw new RangeError(`Metrics accept at most ${MAX_METRIC_ATTRIBUTES} attributes`);
    }
    if (key.length === 0) throw new TypeError("Metric attribute names must not be empty");
    const keyBytes = textEncoder.encode(key).byteLength;
    if (keyBytes > MAX_ATTRIBUTE_KEY_BYTES) {
      throw new RangeError(
        `Metric attribute names must not exceed ${MAX_ATTRIBUTE_KEY_BYTES} UTF-8 bytes`,
      );
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new TypeError(`Metric attribute "${key}" must be a string, number, or boolean`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError("Numeric metric attribute values must be finite");
    }
    const valueBytes = typeof value === "string" ? textEncoder.encode(value).byteLength : 8;
    if (typeof value === "string" && valueBytes > MAX_ATTRIBUTE_STRING_BYTES) {
      throw new RangeError(
        `Metric attribute values must not exceed ${MAX_ATTRIBUTE_STRING_BYTES} UTF-8 bytes`,
      );
    }
    attributeBytes += keyBytes + valueBytes;
    if (attributeBytes > MAX_ATTRIBUTE_DATA_BYTES) {
      throw new RangeError(
        `Metric attributes must not exceed ${MAX_ATTRIBUTE_DATA_BYTES} UTF-8 bytes in total`,
      );
    }
    setAttribute(normalized, key, value);
  }

  const context = getCurrentRequestContext();
  if (context?.projectId) setAttribute(normalized, "project_id", context.projectId);
  if (context?.projectSlug) setAttribute(normalized, "project_slug", context.projectSlug);
  if (context) {
    const environmentName = context.environmentName ??
      (!context.productionMode ? "preview" : undefined);
    if (environmentName) setAttribute(normalized, "environment", environmentName);
    if (!context.productionMode) setAttribute(normalized, "branch", context.branch ?? "main");
  }

  return normalized;
}

function normalizeOptions(options?: MetricInstrumentOptions): MetricInstrumentOptions {
  if (options === undefined) return Object.freeze({});
  const { description, unit } = options;
  if (description !== undefined) {
    if (typeof description !== "string") {
      throw new TypeError("Metric descriptions must be strings");
    }
    if (description.length > MAX_METRIC_DESCRIPTION_LENGTH) {
      throw new RangeError(
        `Metric descriptions must not exceed ${MAX_METRIC_DESCRIPTION_LENGTH} characters`,
      );
    }
  }
  if (unit !== undefined) {
    if (typeof unit !== "string") throw new TypeError("Metric units must be strings");
    if (unit.length > MAX_METRIC_UNIT_LENGTH) {
      throw new RangeError(`Metric units must not exceed ${MAX_METRIC_UNIT_LENGTH} characters`);
    }
  }
  return Object.freeze({ description, unit });
}

function validateName(name: string): void {
  if (typeof name !== "string" || !METRIC_NAME_PATTERN.test(name)) {
    throw new TypeError(
      "Metric names must begin with an ASCII letter, contain only letters, digits, underscores, dots, slashes, or hyphens, and be at most 255 characters",
    );
  }
}

function validateFiniteValue(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError("Metric values must be finite numbers");
  }
}

/**
 * Add a non-negative value to a monotonic counter.
 *
 * @throws {TypeError} When the metric name or options are invalid.
 * @throws {RangeError} When the value is negative or non-finite.
 */
export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  validateName(name);
  validateFiniteValue(value);
  if (value < 0) throw new RangeError("Counter values must be non-negative");

  const normalizedAttributes = normalizeAttributes(attributes);
  const normalizedOptions = normalizeOptions(options);
  registerMetricInstrument("counter", name, normalizedOptions);
  if (
    !enqueueDirectMetric("counter", name, value, normalizedAttributes, normalizedOptions)
  ) {
    recordSdkCounter(name, value, normalizedAttributes, normalizedOptions);
  }
}

/**
 * Record a finite observation in a histogram.
 *
 * @throws {TypeError} When the metric name or options are invalid.
 * @throws {RangeError} When the value is non-finite.
 */
export function histogram(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  validateName(name);
  validateFiniteValue(value);

  const normalizedAttributes = normalizeAttributes(attributes);
  const normalizedOptions = normalizeOptions(options);
  registerMetricInstrument("histogram", name, normalizedOptions);
  if (
    !enqueueDirectMetric("histogram", name, value, normalizedAttributes, normalizedOptions)
  ) {
    recordSdkHistogram(name, value, normalizedAttributes, normalizedOptions);
  }
}

/**
 * Set the latest finite value for a gauge series.
 *
 * @throws {TypeError} When the metric name or options are invalid.
 * @throws {RangeError} When the value is non-finite.
 */
export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  validateName(name);
  validateFiniteValue(value);

  const normalizedAttributes = normalizeAttributes(attributes);
  const normalizedOptions = normalizeOptions(options);
  registerMetricInstrument("gauge", name, normalizedOptions);
  if (!enqueueDirectMetric("gauge", name, value, normalizedAttributes, normalizedOptions)) {
    recordSdkGauge(name, value, normalizedAttributes, normalizedOptions);
  }
}

/** Runtime and application metric operations. */
export const metrics: Readonly<{
  counter: typeof counter;
  histogram: typeof histogram;
  gauge: typeof gauge;
}> = Object.freeze({ counter, histogram, gauge });
