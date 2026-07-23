import {
  type AttributeValue,
  type Counter,
  getGlobalMetricsAPI,
  type Histogram,
  type Meter,
  type ObservableGauge,
} from "#veryfront/observability";
import type { MetricsAPI } from "#veryfront/observability/tracing/api-shim.ts";
import { attributesKey, createOverflowAttributes } from "./attributes.ts";
import type { MetricInstrumentOptions } from "./index.ts";

interface GaugeSample {
  value: number;
  attributes: Record<string, AttributeValue>;
}

interface GaugeState {
  instrument: ObservableGauge;
  samples: Map<string, GaugeSample>;
}

const MAX_INSTRUMENTS_PER_KIND = 1_000;
const MAX_GAUGE_SERIES_PER_INSTRUMENT = 2_000;

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, GaugeState>();
let activeMetricsApi: MetricsAPI | null = null;
let activeMeter: Meter | null = null;

function clearGaugeSamples(): void {
  for (const gauge of gauges.values()) gauge.samples.clear();
}

function clearInstrumentCaches(): void {
  clearGaugeSamples();
  counters.clear();
  histograms.clear();
  gauges.clear();
}

function getMeter() {
  const metricsApi = getGlobalMetricsAPI();
  if (metricsApi !== activeMetricsApi) {
    clearInstrumentCaches();
    activeMetricsApi = metricsApi;
    activeMeter = metricsApi?.getMeter("veryfront.project.metrics") ?? null;
  }
  return activeMeter;
}

function instrumentKey(name: string, options: MetricInstrumentOptions): string {
  return JSON.stringify([name.toLowerCase(), options.description ?? null, options.unit ?? null]);
}

function assertInstrumentCapacity<T>(cache: Map<string, T>, kind: string): void {
  if (cache.size >= MAX_INSTRUMENTS_PER_KIND) {
    throw new RangeError(
      `Cannot create more than ${MAX_INSTRUMENTS_PER_KIND} ${kind} instruments in one process`,
    );
  }
}

function getCounter(name: string, options: MetricInstrumentOptions): Counter | null {
  const meter = getMeter();
  if (!meter) return null;

  const key = instrumentKey(name, options);
  const cached = counters.get(key);
  if (cached) return cached;

  assertInstrumentCapacity(counters, "counter");
  const counter = meter.createCounter(name, options);
  counters.set(key, counter);
  return counter;
}

function getHistogram(name: string, options: MetricInstrumentOptions): Histogram | null {
  const meter = getMeter();
  if (!meter) return null;

  const key = instrumentKey(name, options);
  const cached = histograms.get(key);
  if (cached) return cached;

  assertInstrumentCapacity(histograms, "histogram");
  const histogram = meter.createHistogram(name, options);
  histograms.set(key, histogram);
  return histogram;
}

function getGauge(name: string, options: MetricInstrumentOptions): GaugeState | null {
  const meter = getMeter();
  if (!meter) return null;

  const key = instrumentKey(name, options);
  const cached = gauges.get(key);
  if (cached) return cached;

  assertInstrumentCapacity(gauges, "gauge");
  const samples = new Map<string, GaugeSample>();
  const instrument = meter.createObservableGauge(name, options);
  instrument.addCallback((result) => {
    for (const sample of samples.values()) {
      result.observe(sample.value, sample.attributes);
    }
  });

  const gauge = { instrument, samples };
  gauges.set(key, gauge);
  return gauge;
}

export function recordSdkCounter(
  name: string,
  value: number,
  attributes: Record<string, AttributeValue>,
  options: MetricInstrumentOptions,
): void {
  getCounter(name, options)?.add(value, attributes);
}

export function recordSdkHistogram(
  name: string,
  value: number,
  attributes: Record<string, AttributeValue>,
  options: MetricInstrumentOptions,
): void {
  getHistogram(name, options)?.record(value, attributes);
}

export function recordSdkGauge(
  name: string,
  value: number,
  attributes: Record<string, AttributeValue>,
  options: MetricInstrumentOptions,
): void {
  const gauge = getGauge(name, options);
  if (!gauge) return;

  const key = attributesKey(attributes);
  if (
    gauge.samples.has(key) ||
    gauge.samples.size < MAX_GAUGE_SERIES_PER_INSTRUMENT - 1
  ) {
    gauge.samples.set(key, { value, attributes });
    return;
  }

  const overflowAttributes = createOverflowAttributes(attributes);
  const overflowKey = attributesKey(overflowAttributes);
  if (!gauge.samples.has(overflowKey) && gauge.samples.size >= MAX_GAUGE_SERIES_PER_INSTRUMENT) {
    return;
  }
  gauge.samples.set(overflowKey, {
    value,
    attributes: overflowAttributes,
  });
}

export function resetSdkMetricInstrumentsForTests(): void {
  clearInstrumentCaches();
  activeMetricsApi = null;
  activeMeter = null;
}
