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
  type Histogram,
  type ObservableGauge,
} from "#veryfront/observability";
import { getGlobalMetricsAPI } from "#veryfront/observability/tracing/api-shim.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getDenoRuntime } from "#veryfront/platform/compat/runtime.ts";
import { isProjectEnvActive } from "#veryfront/server/project-env/storage.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

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

type DirectMetricKind = "counter" | "histogram" | "gauge";

interface DirectMetricsTarget {
  url: string;
  headers: Record<string, string>;
  serviceName: string;
  serviceVersion: string;
}

interface DirectMetricSample {
  kind: DirectMetricKind;
  name: string;
  value: number;
  attributes: Record<string, AttributeValue>;
  timestampUnixNano: string;
}

interface DirectExportGroup {
  key: string;
  target: DirectMetricsTarget;
  samples: DirectMetricSample[];
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<
  string,
  { instrument: ObservableGauge; samples: Map<string, GaugeSample> }
>();
const directQueue: DirectMetricSample[] = [];
const directSampleTargets = new WeakMap<DirectMetricSample, string>();
const directCounterTotals = new Map<string, { value: number; startTimeUnixNano: string }>();
const directHistogramTotals = new Map<
  string,
  {
    count: number;
    sum: number;
    bucketCounts: number[];
    startTimeUnixNano: string;
  }
>();
let directFlushTimer: ReturnType<typeof setTimeout> | null = null;

const DIRECT_FLUSH_DELAY_MS = 1_000;
const DIRECT_EXPORT_TIMEOUT_MS = 10_000;
const DIRECT_MAX_BATCH_SIZE = 100;
const DIRECT_MAX_INTERNED_TARGETS = DIRECT_MAX_BATCH_SIZE;
const HISTOGRAM_BOUNDS = [0, 10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const apply = Reflect.apply;
const NativeAbortController = AbortController;
const AbortControllerPrototypeAbort = AbortController.prototype.abort;
const AbortControllerSignalGetter = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  "signal",
)?.get;
const objectKeys = Object.keys;
const arraySort = Array.prototype.sort;
const arrayPush = Array.prototype.push;
const arraySplice = Array.prototype.splice;
const mapDelete = Map.prototype.delete;
const mapForEach = Map.prototype.forEach;
const stringStartsWith = String.prototype.startsWith;
const weakMapDelete = WeakMap.prototype.delete;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const hostBtoa = typeof globalThis.btoa === "function" ? globalThis.btoa : undefined;
const mathMin = Math.min;
const NativeTextEncoder = TextEncoder;
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const stringFromCharCode = String.fromCharCode;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const utf8Encoder = new NativeTextEncoder();
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
// Capture the runtime transport before project code can replace the ambient fetch.
// Host-authenticated telemetry must never cross a project-controlled function.
const hostFetch = globalThis.fetch.bind(globalThis);
const useAmbientFetchForTests = (() => {
  const deno = getDenoRuntime();
  if (!deno) return false;
  try {
    return deno.env.get("DENO_TESTING") === "1";
  } catch {
    return false;
  }
})();

function encodeHostBase64(value: string): string {
  if (!hostBtoa || !typedArrayByteLength) {
    throw new Error("Base64 encoding is not supported in this runtime");
  }
  try {
    return apply(hostBtoa, globalThis, [value]) as string;
  } catch {
    // Preserve the existing UTF-8 fallback without consulting mutable globals.
    const bytes = apply(textEncoderEncode, utf8Encoder, [value]) as Uint8Array;
    const byteLength = apply(typedArrayByteLength, bytes, []) as number;
    const chunkSize = 24 * 1_024;
    let encoded = "";
    for (let offset = 0; offset < byteLength; offset += chunkSize) {
      const end = apply(mathMin, undefined, [offset + chunkSize, byteLength]) as number;
      let binary = "";
      for (let index = offset; index < end; index++) {
        binary += apply(stringFromCharCode, undefined, [bytes[index]]) as string;
      }
      encoded += apply(hostBtoa, globalThis, [binary]) as string;
    }
    return encoded;
  }
}

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
  if (context) {
    const environmentName = context.environmentName ??
      (!context.productionMode ? "preview" : undefined);
    if (environmentName) normalized.environment = environmentName;
    if (!context.productionMode) normalized.branch = context.branch ?? "main";
  }

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

function resolveProjectOtlpMetricsUrl(): string | null {
  if (readProjectEnv("OTEL_METRICS_ENABLED") !== "true") return null;
  const endpoint = readProjectEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    readProjectEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!endpoint) return null;
  const trimmed = endpoint.replace(/\/$/, "");
  return trimmed.endsWith("/v1/metrics") ? trimmed : `${trimmed}/v1/metrics`;
}

function resolveOtlpMetricsUrl(): string | null {
  if (readEnv("OTEL_METRICS_ENABLED") !== "true") return null;
  const endpoint = readEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    readEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!endpoint) return null;
  const trimmed = endpoint.replace(/\/$/, "");
  return trimmed.endsWith("/v1/metrics") ? trimmed : `${trimmed}/v1/metrics`;
}

function resolveInternalMetricsUrl(): string | null {
  if (readHostEnv("OTEL_METRICS_ENABLED") !== "true") return null;
  const apiBaseUrl = readHostEnv("VERYFRONT_API_BASE_URL") ?? readHostEnv("VERYFRONT_API_URL");
  const username = readHostEnv("VERYFRONT_API_INTERNAL_USER");
  const password = readHostEnv("VERYFRONT_API_INTERNAL_PASS");
  if (!apiBaseUrl || !username || !password) return null;
  return `${apiBaseUrl.replace(/\/$/, "")}/internal/metrics/otlp/v1/metrics`;
}

function buildBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  return `Basic ${encodeHostBase64(credentials)}`;
}

function parseHeaders(headerInput: string | undefined): Record<string, string> {
  if (!headerInput) return {};
  if (headerInput.startsWith("Basic ")) return { Authorization: headerInput };
  if (headerInput.startsWith("Authorization=")) {
    return { Authorization: headerInput.slice("Authorization=".length) };
  }

  const result: Record<string, string> = {};
  for (const part of headerInput.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) {
      result[key.trim()] = valueParts.join("=").trim();
    }
  }
  return result;
}

function resolveDirectServiceIdentity(): Pick<
  DirectMetricsTarget,
  "serviceName" | "serviceVersion"
> {
  return {
    serviceName: readEnv("OTEL_SERVICE_NAME") ?? "veryfront",
    serviceVersion: readEnv("VERYFRONT_VERSION") ??
      readEnv("RELEASE_VERSION") ??
      "unknown",
  };
}

function resolveDirectMetricsTarget(): DirectMetricsTarget | null {
  const projectOtlpUrl = resolveProjectOtlpMetricsUrl();
  if (isDedicatedRuntime() && projectOtlpUrl) {
    return {
      url: projectOtlpUrl,
      headers: parseHeaders(
        readProjectEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") ??
          readProjectEnv("OTEL_EXPORTER_OTLP_HEADERS"),
      ),
      ...resolveDirectServiceIdentity(),
    };
  }

  const internalUrl = resolveInternalMetricsUrl();
  if (internalUrl) {
    return {
      url: internalUrl,
      headers: {
        Authorization: buildBasicAuth(
          readHostEnv("VERYFRONT_API_INTERNAL_USER") ?? "",
          readHostEnv("VERYFRONT_API_INTERNAL_PASS") ?? "",
        ),
      },
      ...resolveDirectServiceIdentity(),
    };
  }

  const otlpUrl = resolveOtlpMetricsUrl();
  if (!otlpUrl) return null;
  return {
    url: otlpUrl,
    headers: parseHeaders(
      readEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") ??
        readEnv("OTEL_EXPORTER_OTLP_HEADERS"),
    ),
    ...resolveDirectServiceIdentity(),
  };
}

function sortHeaderNames(names: string[]): string[] {
  return apply(arraySort, names, [
    (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0),
  ]) as string[];
}

function headersEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftNames = sortHeaderNames(apply(objectKeys, Object, [left]) as string[]);
  const rightNames = sortHeaderNames(apply(objectKeys, Object, [right]) as string[]);
  if (leftNames.length !== rightNames.length) return false;
  for (let index = 0; index < leftNames.length; index++) {
    const name = leftNames[index];
    if (name === undefined || name !== rightNames[index]) return false;
    if (left[name] !== right[name]) return false;
  }
  return true;
}

// Target identities are interned so the key is an opaque counter rather than a
// rendering of the target itself. `headers` can carry the host-generated
// internal-proxy Basic credential, and the key ends up in long-lived map keys
// and in the flush grouping, so it must never contain that secret. Comparison
// runs on captured intrinsics and primitive operators only: in a dedicated
// runtime, project code can replace `Object.entries`, `Array.prototype.sort`,
// `String.prototype.localeCompare` and `JSON.stringify`, and any of those would
// otherwise be handed the credential. A fixed LRU bound prevents mutable
// project telemetry settings from retaining an unbounded number of targets.
interface InternedDirectMetricsTarget {
  target: DirectMetricsTarget;
  key: string;
  pendingSamples: number;
  lastUsed: number;
}

const internedTargets: InternedDirectMetricsTarget[] = [];
let nextInternedTargetId = 0;
let nextInternedTargetUse = 0;
let directExportTimeoutMs = DIRECT_EXPORT_TIMEOUT_MS;

function deleteDirectTotalsForTarget(targetKey: string): void {
  const prefix = `${targetKey}:`;
  const deleteMatching = (_value: unknown, key: string, totals: Map<string, unknown>): void => {
    if (apply(stringStartsWith, key, [prefix])) {
      apply(mapDelete, totals, [key]);
    }
  };
  apply(mapForEach, directCounterTotals, [deleteMatching]);
  apply(mapForEach, directHistogramTotals, [deleteMatching]);
}

function evictUnusedDirectTarget(): boolean {
  let candidateIndex = -1;
  let candidateUse = Number.POSITIVE_INFINITY;
  for (let index = 0; index < internedTargets.length; index++) {
    const interned = internedTargets[index];
    if (
      interned !== undefined && interned.pendingSamples === 0 &&
      interned.lastUsed < candidateUse
    ) {
      candidateIndex = index;
      candidateUse = interned.lastUsed;
    }
  }
  if (candidateIndex === -1) return false;
  const evicted = apply(arraySplice, internedTargets, [
    candidateIndex,
    1,
  ]) as InternedDirectMetricsTarget[];
  if (evicted[0]) deleteDirectTotalsForTarget(evicted[0].key);
  return true;
}

function retainDirectTarget(target: DirectMetricsTarget): string | null {
  for (let index = 0; index < internedTargets.length; index++) {
    const interned = internedTargets[index];
    if (
      interned !== undefined &&
      interned.target.url === target.url &&
      interned.target.serviceName === target.serviceName &&
      interned.target.serviceVersion === target.serviceVersion &&
      headersEqual(interned.target.headers, target.headers)
    ) {
      interned.pendingSamples++;
      interned.lastUsed = nextInternedTargetUse++;
      return interned.key;
    }
  }
  if (
    internedTargets.length >= DIRECT_MAX_INTERNED_TARGETS &&
    !evictUnusedDirectTarget()
  ) {
    return null;
  }
  const key = `t${nextInternedTargetId++}`;
  internedTargets[internedTargets.length] = {
    target,
    key,
    pendingSamples: 1,
    lastUsed: nextInternedTargetUse++,
  };
  return key;
}

function takeDirectTargetForSample(
  sample: DirectMetricSample,
): { key: string; target: DirectMetricsTarget } | undefined {
  const key = apply(weakMapGet, directSampleTargets, [sample]) as string | undefined;
  apply(weakMapDelete, directSampleTargets, [sample]);
  if (key === undefined) return undefined;
  for (let index = 0; index < internedTargets.length; index++) {
    const interned = internedTargets[index];
    if (interned?.key === key) {
      return { key, target: interned.target };
    }
  }
  return undefined;
}

function releaseDirectTargetSamples(targetKey: string, count: number): void {
  for (let index = 0; index < internedTargets.length; index++) {
    const interned = internedTargets[index];
    if (interned?.key !== targetKey) continue;
    const remaining = interned.pendingSamples - count;
    interned.pendingSamples = remaining > 0 ? remaining : 0;
    return;
  }
}

function toOtlpValue(value: AttributeValue) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return { doubleValue: value };
  return { stringValue: String(value) };
}

function toOtlpAttributes(attributes: Record<string, AttributeValue>) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: toOtlpValue(value),
  }));
}

function getUnixNanoTimestamp(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

function buildHistogramBuckets(value: number): number[] {
  const counts = new Array(HISTOGRAM_BOUNDS.length + 1).fill(0);
  const bucketIndex = HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
  counts[bucketIndex === -1 ? counts.length - 1 : bucketIndex] = 1;
  return counts;
}

function buildDirectMetric(sample: DirectMetricSample, targetKey: string) {
  const attributes = toOtlpAttributes(sample.attributes);
  if (sample.kind === "counter") {
    const key = `${targetKey}:${sample.name}:${attributesKey(sample.attributes)}`;
    const total = directCounterTotals.get(key) ?? {
      value: 0,
      startTimeUnixNano: sample.timestampUnixNano,
    };
    total.value += sample.value;
    directCounterTotals.set(key, total);

    return {
      name: sample.name,
      sum: {
        dataPoints: [{
          attributes,
          startTimeUnixNano: total.startTimeUnixNano,
          timeUnixNano: sample.timestampUnixNano,
          asDouble: total.value,
        }],
        aggregationTemporality: 2,
        isMonotonic: true,
      },
    };
  }

  if (sample.kind === "histogram") {
    const key = `${targetKey}:${sample.name}:${attributesKey(sample.attributes)}`;
    const total = directHistogramTotals.get(key) ?? {
      count: 0,
      sum: 0,
      bucketCounts: new Array(HISTOGRAM_BOUNDS.length + 1).fill(0),
      startTimeUnixNano: sample.timestampUnixNano,
    };
    const sampleBuckets = buildHistogramBuckets(sample.value);
    total.count += 1;
    total.sum += sample.value;
    total.bucketCounts = total.bucketCounts.map((count, index) => count + sampleBuckets[index]);
    directHistogramTotals.set(key, total);

    return {
      name: sample.name,
      histogram: {
        dataPoints: [{
          attributes,
          startTimeUnixNano: total.startTimeUnixNano,
          timeUnixNano: sample.timestampUnixNano,
          count: total.count,
          sum: total.sum,
          explicitBounds: HISTOGRAM_BOUNDS,
          bucketCounts: total.bucketCounts,
        }],
        aggregationTemporality: 2,
      },
    };
  }

  return {
    name: sample.name,
    gauge: {
      dataPoints: [{
        attributes,
        timeUnixNano: sample.timestampUnixNano,
        asDouble: sample.value,
      }],
    },
  };
}

function buildDirectOtlpBody(
  samples: DirectMetricSample[],
  target: DirectMetricsTarget,
  targetKey: string,
) {
  return {
    resourceMetrics: [{
      resource: {
        // Resolved at enqueue time alongside the target — never from the
        // ambient context of whichever environment happens to run the flush.
        attributes: toOtlpAttributes({
          "service.name": target.serviceName,
          "service.version": target.serviceVersion,
        }),
      },
      scopeMetrics: [{
        scope: {
          name: "veryfront.project.metrics",
        },
        metrics: samples.map((sample) => buildDirectMetric(sample, targetKey)),
      }],
    }],
  };
}

function logDirectExportFailure(error: unknown): void {
  // debug level — suppressed at default INFO threshold, visible with --debug / LOG_LEVEL=DEBUG.
  serverLogger.debug(
    "metrics: direct OTLP export failed",
    error instanceof Error ? error : { reason: String(error) },
  );
}

function createDirectExportDeadline(): {
  signal: AbortSignal;
  clear(): void;
} {
  if (!AbortControllerSignalGetter) {
    throw new TypeError("AbortController signal intrinsic is unavailable");
  }
  const controller = new NativeAbortController();
  const signal = apply(AbortControllerSignalGetter, controller, []) as AbortSignal;
  const timeout = hostSetTimeout(() => {
    apply(AbortControllerPrototypeAbort, controller, []);
  }, directExportTimeoutMs);
  return {
    signal,
    clear: () => hostClearTimeout(timeout),
  };
}

async function exportDirectGroup(group: DirectExportGroup): Promise<void> {
  const deadline = createDirectExportDeadline();
  try {
    const response = await (useAmbientFetchForTests ? globalThis.fetch : hostFetch)(
      group.target.url,
      {
        method: "POST",
        headers: {
          ...group.target.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDirectOtlpBody(group.samples, group.target, group.key)),
        signal: deadline.signal,
      },
    );
    if (!response.ok) logDirectExportFailure(`HTTP ${response.status}`);
  } catch (error) {
    logDirectExportFailure(error);
  } finally {
    deadline.clear();
  }
}

async function exportAndReleaseDirectGroup(group: DirectExportGroup): Promise<void> {
  try {
    await exportDirectGroup(group);
  } finally {
    releaseDirectTargetSamples(group.key, group.samples.length);
  }
}

async function flushDirectMetrics(): Promise<void> {
  if (directFlushTimer) {
    clearTimeout(directFlushTimer);
    directFlushTimer = null;
  }

  if (directQueue.length === 0) return;

  // Group by the target each sample was bound to when it was enqueued. The
  // queue is shared across concurrent project environments, so a single
  // ambient-context target resolution here would misroute other tenants'
  // samples.
  const batch = apply(arraySplice, directQueue, [0, DIRECT_MAX_BATCH_SIZE]) as DirectMetricSample[];
  // Plain arrays and index loops rather than a Map or iterator protocol: a
  // group holds the target, and `target.headers` can carry the internal-proxy
  // credential, so it must not be handed to `Map.prototype.set` or to
  // `Array.prototype[Symbol.iterator]`, both replaceable by project code.
  const groups: DirectExportGroup[] = [];
  for (let index = 0; index < batch.length; index++) {
    const sample = batch[index];
    if (sample === undefined) continue;
    const binding = takeDirectTargetForSample(sample);
    if (!binding) continue;
    const { key, target } = binding;
    let group: DirectExportGroup | undefined;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const candidate = groups[groupIndex];
      if (candidate !== undefined && candidate.key === key) {
        group = candidate;
        break;
      }
    }
    if (!group) {
      group = { key, target, samples: [] };
      groups[groups.length] = group;
    }
    group.samples[group.samples.length] = sample;
  }

  // Start every target request before awaiting any of them. Each request owns
  // a deadline, so one tenant endpoint cannot block another target or retain a
  // removed batch indefinitely.
  const exports = new Array<Promise<void>>(groups.length);
  for (let index = 0; index < groups.length; index++) {
    exports[index] = exportAndReleaseDirectGroup(groups[index]!);
  }
  for (let index = 0; index < exports.length; index++) {
    await exports[index];
  }

  if (directQueue.length > 0) {
    scheduleDirectFlush();
  }
}

function scheduleDirectFlush(): void {
  if (directFlushTimer) return;
  directFlushTimer = setTimeout(() => {
    void flushDirectMetrics();
  }, DIRECT_FLUSH_DELAY_MS);
  try {
    if (typeof directFlushTimer === "number") {
      Deno.unrefTimer(directFlushTimer);
    } else {
      (directFlushTimer as { unref?: () => void }).unref?.();
    }
  } catch {
    // Some runtimes do not expose unref support; exporting still works there.
  }
}

function enqueueDirectMetric(
  kind: DirectMetricKind,
  name: string,
  value: number,
  attributes: Record<string, AttributeValue>,
): void {
  const target = resolveDirectMetricsTarget();
  if (target === null) return;
  const targetKey = retainDirectTarget(target);
  if (targetKey === null) return;
  const sample: DirectMetricSample = {
    kind,
    name,
    value,
    attributes,
    timestampUnixNano: getUnixNanoTimestamp(),
  };
  apply(weakMapSet, directSampleTargets, [sample, targetKey]);
  apply(arrayPush, directQueue, [sample]);
  if (directQueue.length >= DIRECT_MAX_BATCH_SIZE) {
    void flushDirectMetrics();
    return;
  }
  scheduleDirectFlush();
}

export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  const normalizedAttributes = normalizeAttributes(attributes);
  if (resolveDirectMetricsTarget() === null) {
    getCounter(name, options)?.add(value, normalizedAttributes);
    return;
  }
  enqueueDirectMetric("counter", name, value, normalizedAttributes);
}

export function histogram(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  const normalizedAttributes = normalizeAttributes(attributes);
  if (resolveDirectMetricsTarget() === null) {
    getHistogram(name, options)?.record(value, normalizedAttributes);
    return;
  }
  enqueueDirectMetric("histogram", name, value, normalizedAttributes);
}

export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  options?: MetricInstrumentOptions,
): void {
  const normalizedAttributes = normalizeAttributes(attributes);
  if (resolveDirectMetricsTarget() !== null) {
    enqueueDirectMetric("gauge", name, value, normalizedAttributes);
    return;
  }
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
  async __flushForTests(): Promise<void> {
    await flushDirectMetrics();
  },
  __setDirectExportTimeoutForTests(timeoutMs: number): void {
    directExportTimeoutMs = timeoutMs;
  },
  __getDirectTargetCountForTests(): number {
    return internedTargets.length;
  },
  __resetForTests(): void {
    counters.clear();
    histograms.clear();
    gauges.clear();
    directQueue.length = 0;
    directCounterTotals.clear();
    directHistogramTotals.clear();
    internedTargets.length = 0;
    nextInternedTargetId = 0;
    nextInternedTargetUse = 0;
    directExportTimeoutMs = DIRECT_EXPORT_TIMEOUT_MS;
    if (directFlushTimer) {
      clearTimeout(directFlushTimer);
      directFlushTimer = null;
    }
  },
};
