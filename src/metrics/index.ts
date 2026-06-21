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
  type ObservableGauge,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

export type MetricAttributeValue = string | number | boolean | null | undefined;
export type MetricAttributes = Record<string, MetricAttributeValue>;

export interface MetricInstrumentOptions {
  description?: string;
  unit?: string;
}

interface GaugeSample {
  value: number;
  attributes: Record<string, AttributeValue>;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<
  string,
  { instrument: ObservableGauge; samples: Map<string, GaugeSample> }
>();

function getMeter() {
  return getGlobalMetricsAPI()?.getMeter("veryfront.project.metrics");
}

function normalizeAttributes(attributes?: MetricAttributes): Record<string, AttributeValue> {
  const normalized: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined) continue;
    normalized[key] = value;
  }

  const context = getCurrentRequestContext();
  if (context?.projectId) normalized.project_id = context.projectId;
  if (context?.projectSlug) normalized.project_slug = context.projectSlug;
  if (context?.environmentName) normalized.environment = context.environmentName;

  return normalized;
}

function attributesKey(attributes: Record<string, AttributeValue>): string {
  return JSON.stringify(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  );
}

function getCounter(name: string, options?: MetricInstrumentOptions): Counter | null {
  const cached = counters.get(name);
  if (cached) return cached;

  const meter = getMeter();
  if (!meter) return null;

  const counter = meter.createCounter(name, options);
  counters.set(name, counter);
  return counter;
}

function getHistogram(name: string, options?: MetricInstrumentOptions): Histogram | null {
  const cached = histograms.get(name);
  if (cached) return cached;

  const meter = getMeter();
  if (!meter) return null;

  const histogram = meter.createHistogram(name, options);
  histograms.set(name, histogram);
  return histogram;
}

function getGauge(name: string, options?: MetricInstrumentOptions) {
  const cached = gauges.get(name);
  if (cached) return cached;

  const meter = getMeter();
  if (!meter) return null;

  const samples = new Map<string, GaugeSample>();
  const instrument = meter.createObservableGauge(name, options);
  instrument.addCallback((result) => {
    for (const sample of samples.values()) {
      result.observe(sample.value, sample.attributes);
    }
  });

  const gauge = { instrument, samples };
  gauges.set(name, gauge);
  return gauge;
}

export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  getCounter(name, options)?.add(value, normalizeAttributes(attributes));
}

export function histogram(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  getHistogram(name, options)?.record(value, normalizeAttributes(attributes));
}

export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  const normalizedAttributes = normalizeAttributes(attributes);
  const target = getGauge(name, options);
  if (!target) return;

  target.samples.set(attributesKey(normalizedAttributes), {
    value,
    attributes: normalizedAttributes,
  });
}

export const metrics = {
  counter,
  histogram,
  gauge,
  __resetForTests(): void {
    counters.clear();
    histograms.clear();
    gauges.clear();
  },
};
