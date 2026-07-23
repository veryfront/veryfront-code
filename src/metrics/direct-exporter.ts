import type { AttributeValue } from "#veryfront/observability";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { unrefTimer } from "#veryfront/platform/compat/process/lifecycle.ts";
import { getProjectEnv, isProjectEnvActive } from "#veryfront/server/project-env/storage.ts";
import { attributesKey, createOverflowAttributes } from "./attributes.ts";
import { instrumentIdentityKey, type MetricInstrumentKind } from "./instrument-definitions.ts";
import type { MetricInstrumentOptions } from "./index.ts";

export type DirectMetricKind = MetricInstrumentKind;

interface DirectMetricSample {
  kind: DirectMetricKind;
  name: string;
  value: number;
  attributes: Record<string, AttributeValue>;
  options: MetricInstrumentOptions;
  timestampUnixNano: string;
  estimatedSizeBytes: number;
}

interface DirectMetricsTarget {
  key: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  resourceAttributes: Readonly<Record<string, AttributeValue>>;
  timeoutMs: number;
  compression: "none" | "gzip";
}

interface CounterTotal {
  value: number;
  startTimeUnixNano: string;
}

interface HistogramTotal {
  count: bigint;
  sum: number | null;
  bucketCounts: bigint[];
  startTimeUnixNano: string;
}

interface DestinationState {
  target: DirectMetricsTarget;
  queue: DirectMetricSample[];
  queuedBytes: number;
  counterTotals: Map<string, CounterTotal>;
  histogramTotals: Map<string, HistogramTotal>;
  instruments: Set<string>;
  seriesByInstrument: Map<string, Set<string>>;
  seriesCount: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  drainPromise: Promise<void> | null;
  lastUsed: number;
}

interface MetricGroup {
  kind: DirectMetricKind;
  name: string;
  options: MetricInstrumentOptions;
  dataPoints: Map<string, Record<string, unknown>>;
}

interface ExportAttemptResult {
  ok: boolean;
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
  reason: "success" | "http" | "network" | "shutdown";
}

type ExportSlotRelease = () => void;
type ExportSlotWaiter = (release: ExportSlotRelease | null) => void;

const DIRECT_FLUSH_DELAY_MS = 1_000;
const DIRECT_MAX_BATCH_SIZE = 100;
const DIRECT_MAX_QUEUE_SIZE = 10_000;
const DIRECT_MAX_BATCH_BYTES = 512 * 1_024;
const DIRECT_MAX_QUEUE_BYTES = 4 * 1_024 * 1_024;
const DIRECT_MAX_DESTINATIONS = 64;
const DIRECT_MAX_INSTRUMENTS_PER_DESTINATION = 3_000;
const DIRECT_MAX_SERIES_PER_INSTRUMENT = 2_000;
const DIRECT_MAX_SERIES_PER_DESTINATION = 10_000;
const DIRECT_MAX_CONCURRENT_EXPORTS = 4;
const DIRECT_MAX_EXPORT_ATTEMPTS = 5;
const DIRECT_INITIAL_RETRY_DELAY_MS = 100;
const DIRECT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 10_000;
const MAX_EXPORT_TIMEOUT_MS = 300_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;
const HISTOGRAM_BOUNDS = [0, 10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

const destinations = new Map<string, DestinationState>();
const activeExportCancellations = new Map<AbortController, () => void>();
const exportSlotWaiters: ExportSlotWaiter[] = [];
let activeExportCount = 0;
const textEncoder = new TextEncoder();
let referencedTestFlushes = 0;
let lastTimestampUnixNano = 0n;
let shutdownRequested = false;
let shutdownDeadlineReached = false;
let exporterGeneration = 0;

function readProjectEnv(name: string): string | undefined {
  return isProjectEnvActive() ? getProjectEnv(name) : undefined;
}

function isDedicatedRuntime(): boolean {
  return Boolean(getHostEnv("SERVER_ID") && getHostEnv("ENVIRONMENT_IDS"));
}

function decodeHeaderComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseHeaders(headerInput: string | undefined): Readonly<Record<string, string>> {
  if (!headerInput) return Object.freeze({});

  const legacyBasic = headerInput.trim();
  if (/^Basic\s+\S+$/i.test(legacyBasic)) {
    return Object.freeze({ Authorization: legacyBasic });
  }

  const headers = new Headers();
  let headerCount = 0;
  for (const part of headerInput.split(",")) {
    if (headerCount >= 64) break;
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const encodedKey = part.slice(0, separator).trim();
    const encodedValue = part.slice(separator + 1).trim();
    const key = decodeHeaderComponent(encodedKey);
    const value = decodeHeaderComponent(encodedValue);
    if (!key || value === null || key.length > 256 || value.length > 8_192) continue;

    try {
      headers.set(key, value);
      headerCount += 1;
    } catch {
      // Invalid HTTP header names and values are ignored as invalid configuration.
    }
  }

  return Object.freeze(
    Object.fromEntries([...headers.entries()].sort(([left], [right]) => left.localeCompare(right))),
  );
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 24_576;
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    encoded += btoa(String.fromCharCode(...chunk));
  }
  return encoded;
}

function buildBasicAuth(username: string, password: string): string {
  return `Basic ${encodeBase64Utf8(`${username}:${password}`)}`;
}

function readSignalSetting(
  read: (name: string) => string | undefined,
  signalName: string,
  genericName: string,
): string | undefined {
  const signalValue = read(signalName);
  if (signalValue?.trim()) return signalValue;
  const genericValue = read(genericName);
  return genericValue?.trim() ? genericValue : undefined;
}

function parseHttpEndpoint(rawEndpoint: string, appendMetricsPath: boolean): string | null {
  try {
    const endpoint = new URL(rawEndpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return null;
    if (endpoint.username || endpoint.password || endpoint.hash) return null;

    if (appendMetricsPath) {
      const basePath = endpoint.pathname.replace(/\/+$/, "");
      endpoint.pathname = `${basePath}/v1/metrics`;
    }
    return endpoint.toString();
  } catch {
    return null;
  }
}

function appendInternalMetricsPath(rawEndpoint: string): string | null {
  try {
    const endpoint = new URL(rawEndpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return null;
    if (endpoint.username || endpoint.password || endpoint.hash) return null;
    const basePath = endpoint.pathname.replace(/\/+$/, "");
    endpoint.pathname = `${basePath}/internal/metrics/otlp/v1/metrics`;
    return endpoint.toString();
  } catch {
    return null;
  }
}

function parseTimeout(
  read: (name: string) => string | undefined,
): number {
  const raw = readSignalSetting(
    read,
    "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT",
    "OTEL_EXPORTER_OTLP_TIMEOUT",
  );
  if (!raw || !/^\d+$/.test(raw.trim())) return DEFAULT_EXPORT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_EXPORT_TIMEOUT_MS;
  return Math.min(parsed, MAX_EXPORT_TIMEOUT_MS);
}

function supportsConfiguredProtocol(read: (name: string) => string | undefined): boolean {
  const protocol = readSignalSetting(
    read,
    "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
  );
  return protocol === undefined || protocol.trim().toLowerCase() === "http/json";
}

function resolveCompression(
  read: (name: string) => string | undefined,
): "none" | "gzip" | null {
  const compression = (readSignalSetting(
    read,
    "OTEL_EXPORTER_OTLP_METRICS_COMPRESSION",
    "OTEL_EXPORTER_OTLP_COMPRESSION",
  ) ?? "none").trim().toLowerCase();
  if (compression === "none") return "none";
  if (compression === "gzip" && typeof CompressionStream === "function") return "gzip";
  return null;
}

function resolveEndpoint(
  read: (name: string) => string | undefined,
): string | null {
  const signalEndpoint = read("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
  if (signalEndpoint?.trim()) return parseHttpEndpoint(signalEndpoint, false);

  const genericEndpoint = read("OTEL_EXPORTER_OTLP_ENDPOINT");
  return genericEndpoint ? parseHttpEndpoint(genericEndpoint, true) : null;
}

function resolveHeaders(
  read: (name: string) => string | undefined,
): Readonly<Record<string, string>> {
  return parseHeaders(
    readSignalSetting(
      read,
      "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
      "OTEL_EXPORTER_OTLP_HEADERS",
    ),
  );
}

function resolveResourceAttributes(
  read: (name: string) => string | undefined,
): Readonly<Record<string, AttributeValue>> {
  const attributes: Record<string, AttributeValue> = {};
  let attributeCount = 0;
  let attributeBytes = 0;
  for (const part of (read("OTEL_RESOURCE_ATTRIBUTES") ?? "").split(",")) {
    if (attributeCount >= 128) break;
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = decodeHeaderComponent(part.slice(0, separator).trim());
    const value = decodeHeaderComponent(part.slice(separator + 1).trim());
    if (!key || value === null) continue;
    const entryBytes = textEncoder.encode(key).byteLength + textEncoder.encode(value).byteLength;
    if (entryBytes > 4_096 || attributeBytes + entryBytes > 16_384) continue;
    Object.defineProperty(attributes, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    attributeCount += 1;
    attributeBytes += entryBytes;
  }

  attributes["service.name"] = read("OTEL_SERVICE_NAME") ??
    (typeof attributes["service.name"] === "string" ? attributes["service.name"] : "veryfront");
  attributes["service.version"] = read("VERYFRONT_VERSION") ??
    read("RELEASE_VERSION") ??
    (typeof attributes["service.version"] === "string" ? attributes["service.version"] : "unknown");
  return Object.freeze(attributes);
}

function createTarget(input: {
  url: string;
  headers: Readonly<Record<string, string>>;
  resourceAttributes: Readonly<Record<string, AttributeValue>>;
  timeoutMs: number;
  compression: "none" | "gzip";
}): DirectMetricsTarget {
  const key = JSON.stringify([
    input.url,
    Object.entries(input.headers),
    Object.entries(input.resourceAttributes).sort(([left], [right]) => left.localeCompare(right)),
    input.timeoutMs,
    input.compression,
  ]);
  return { ...input, key };
}

function resolveProjectTarget(): DirectMetricsTarget | null {
  if (!isDedicatedRuntime() || !isProjectEnvActive()) return null;
  if (readProjectEnv("OTEL_METRICS_ENABLED") !== "true") return null;

  const read = readProjectEnv;
  if (!supportsConfiguredProtocol(read)) return null;
  const compression = resolveCompression(read);
  if (!compression) return null;
  const url = resolveEndpoint(read);
  if (!url) return null;
  return createTarget({
    url,
    headers: resolveHeaders(read),
    resourceAttributes: resolveResourceAttributes(read),
    timeoutMs: parseTimeout(read),
    compression,
  });
}

function resolveInternalTarget(): DirectMetricsTarget | null {
  if (getHostEnv("OTEL_METRICS_ENABLED") !== "true") return null;
  if (!supportsConfiguredProtocol(getHostEnv)) return null;
  const compression = resolveCompression(getHostEnv);
  if (!compression) return null;
  const baseUrl = getHostEnv("VERYFRONT_API_INTERNAL_URL") ??
    getHostEnv("VERYFRONT_API_BASE_URL") ??
    getHostEnv("VERYFRONT_API_URL");
  const username = getHostEnv("VERYFRONT_API_INTERNAL_USER");
  const password = getHostEnv("VERYFRONT_API_INTERNAL_PASS");
  if (!baseUrl || !username || !password) return null;

  const url = appendInternalMetricsPath(baseUrl);
  if (!url) return null;
  return createTarget({
    url,
    headers: Object.freeze({ Authorization: buildBasicAuth(username, password) }),
    resourceAttributes: resolveResourceAttributes(getHostEnv),
    timeoutMs: parseTimeout(getHostEnv),
    compression,
  });
}

function resolveHostTarget(): DirectMetricsTarget | null {
  if (getHostEnv("OTEL_METRICS_ENABLED") !== "true") return null;
  if (!supportsConfiguredProtocol(getHostEnv)) return null;
  const compression = resolveCompression(getHostEnv);
  if (!compression) return null;
  const url = resolveEndpoint(getHostEnv);
  if (!url) return null;
  return createTarget({
    url,
    headers: resolveHeaders(getHostEnv),
    resourceAttributes: resolveResourceAttributes(getHostEnv),
    timeoutMs: parseTimeout(getHostEnv),
    compression,
  });
}

function resolveDirectMetricsTarget(): DirectMetricsTarget | null {
  try {
    return resolveProjectTarget() ?? resolveInternalTarget() ?? resolveHostTarget();
  } catch {
    logDirectExporterEvent("configuration-error");
    return null;
  }
}

function logDirectExporterEvent(
  reason: string,
  details: { attempts?: number; status?: number } = {},
): void {
  try {
    if (getHostEnv("VERYFRONT_DEBUG") !== "1") return;
    console.warn("[metrics] direct OTLP exporter event", { reason, ...details });
  } catch {
    // Telemetry diagnostics must never interrupt application code.
  }
}

function cancelFlushTimer(state: DestinationState): void {
  if (state.flushTimer === null) return;
  clearTimeout(state.flushTimer);
  state.flushTimer = null;
}

function disposeDestination(state: DestinationState): void {
  cancelFlushTimer(state);
  state.queue.length = 0;
  state.queuedBytes = 0;
  state.counterTotals.clear();
  state.histogramTotals.clear();
  state.instruments.clear();
  state.seriesByInstrument.clear();
}

function evictIdleDestination(): boolean {
  let candidate: DestinationState | null = null;
  for (const state of destinations.values()) {
    if (state.queue.length > 0 || state.drainPromise) continue;
    if (!candidate || state.lastUsed < candidate.lastUsed) candidate = state;
  }
  if (!candidate) return false;
  destinations.delete(candidate.target.key);
  disposeDestination(candidate);
  return true;
}

function getDestinationState(target: DirectMetricsTarget): DestinationState | null {
  const existing = destinations.get(target.key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  if (destinations.size >= DIRECT_MAX_DESTINATIONS && !evictIdleDestination()) {
    logDirectExporterEvent("destination-capacity");
    return null;
  }

  const state: DestinationState = {
    target,
    queue: [],
    queuedBytes: 0,
    counterTotals: new Map(),
    histogramTotals: new Map(),
    instruments: new Set(),
    seriesByInstrument: new Map(),
    seriesCount: 0,
    flushTimer: null,
    drainPromise: null,
    lastUsed: Date.now(),
  };
  destinations.set(target.key, state);
  return state;
}

function instrumentKey(sample: Pick<DirectMetricSample, "kind" | "name" | "options">): string {
  return instrumentIdentityKey(sample.kind, sample.name, sample.options);
}

function constrainSeries(
  state: DestinationState,
  identity: string,
  attributes: Record<string, AttributeValue>,
): Record<string, AttributeValue> | null {
  if (!state.instruments.has(identity)) {
    if (state.instruments.size >= DIRECT_MAX_INSTRUMENTS_PER_DESTINATION) return null;
    state.instruments.add(identity);
    state.seriesByInstrument.set(identity, new Set());
  }

  const series = state.seriesByInstrument.get(identity)!;
  const key = attributesKey(attributes);
  if (series.has(key)) return attributes;

  if (
    series.size < DIRECT_MAX_SERIES_PER_INSTRUMENT - 1 &&
    state.seriesCount < DIRECT_MAX_SERIES_PER_DESTINATION - 1
  ) {
    series.add(key);
    state.seriesCount += 1;
    return attributes;
  }

  const overflowAttributes = createOverflowAttributes(attributes);
  const overflowKey = attributesKey(overflowAttributes);
  if (!series.has(overflowKey)) {
    if (state.seriesCount >= DIRECT_MAX_SERIES_PER_DESTINATION) return null;
    series.add(overflowKey);
    state.seriesCount += 1;
  }
  return overflowAttributes;
}

function getUnixNanoTimestamp(): string {
  const wallClockTimestamp = BigInt(Date.now()) * 1_000_000n;
  lastTimestampUnixNano = wallClockTimestamp > lastTimestampUnixNano
    ? wallClockTimestamp
    : lastTimestampUnixNano + 1n;
  return String(lastTimestampUnixNano);
}

function scheduleDirectFlush(state: DestinationState): void {
  if (state.flushTimer !== null || state.drainPromise) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void requestDestinationDrain(state);
  }, DIRECT_FLUSH_DELAY_MS);
  unrefTimer(state.flushTimer);
}

export function enqueueDirectMetric(
  kind: DirectMetricKind,
  name: string,
  value: number,
  attributes: Record<string, AttributeValue>,
  options: MetricInstrumentOptions,
): boolean {
  if (shutdownRequested) return true;
  const target = resolveDirectMetricsTarget();
  if (!target) return false;

  const state = getDestinationState(target);
  if (!state) return true;

  const identity = instrumentKey({ kind, name, options });
  const constrainedAttributes = constrainSeries(state, identity, attributes);
  if (!constrainedAttributes) {
    logDirectExporterEvent("instrument-capacity");
    return true;
  }
  const timestampUnixNano = getUnixNanoTimestamp();
  const estimatedSizeBytes = textEncoder.encode(JSON.stringify({
    kind,
    name,
    value,
    attributes: constrainedAttributes,
    options,
    timestampUnixNano,
  })).byteLength;
  if (
    state.queue.length >= DIRECT_MAX_QUEUE_SIZE ||
    state.queuedBytes + estimatedSizeBytes > DIRECT_MAX_QUEUE_BYTES
  ) {
    logDirectExporterEvent("queue-capacity");
    return true;
  }

  state.queue.push({
    kind,
    name,
    value,
    attributes: constrainedAttributes,
    options,
    timestampUnixNano,
    estimatedSizeBytes,
  });
  state.queuedBytes += estimatedSizeBytes;
  state.lastUsed = Date.now();

  if (state.queue.length >= DIRECT_MAX_BATCH_SIZE) {
    void requestDestinationDrain(state);
  } else {
    scheduleDirectFlush(state);
  }
  return true;
}

function toOtlpValue(value: AttributeValue): Record<string, unknown> {
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

function buildHistogramBuckets(value: number): number[] {
  const counts = new Array(HISTOGRAM_BOUNDS.length + 1).fill(0) as number[];
  const bucketIndex = HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
  counts[bucketIndex === -1 ? counts.length - 1 : bucketIndex] = 1;
  return counts;
}

function getMetricGroup(
  groups: Map<string, MetricGroup>,
  sample: DirectMetricSample,
): { group: MetricGroup; identity: string; seriesKey: string } {
  const identity = instrumentKey(sample);
  let group = groups.get(identity);
  if (!group) {
    group = {
      kind: sample.kind,
      name: sample.name,
      options: sample.options,
      dataPoints: new Map(),
    };
    groups.set(identity, group);
  }
  return {
    group,
    identity,
    seriesKey: attributesKey(sample.attributes),
  };
}

function addCounterSample(
  state: DestinationState,
  group: MetricGroup,
  identity: string,
  seriesKey: string,
  sample: DirectMetricSample,
): void {
  const totalKey = JSON.stringify([identity, seriesKey]);
  const total = state.counterTotals.get(totalKey) ?? {
    value: 0,
    startTimeUnixNano: sample.timestampUnixNano,
  };
  const nextValue = total.value + sample.value;
  if (Number.isFinite(nextValue)) {
    total.value = nextValue;
  } else {
    total.value = sample.value;
    total.startTimeUnixNano = sample.timestampUnixNano;
  }
  state.counterTotals.set(totalKey, total);
  group.dataPoints.set(seriesKey, {
    attributes: toOtlpAttributes(sample.attributes),
    startTimeUnixNano: total.startTimeUnixNano,
    timeUnixNano: sample.timestampUnixNano,
    asDouble: total.value,
  });
}

function addHistogramSample(
  state: DestinationState,
  group: MetricGroup,
  identity: string,
  seriesKey: string,
  sample: DirectMetricSample,
): void {
  const totalKey = JSON.stringify([identity, seriesKey]);
  const total = state.histogramTotals.get(totalKey) ?? {
    count: 0n,
    sum: 0,
    bucketCounts: new Array(HISTOGRAM_BOUNDS.length + 1).fill(0n) as bigint[],
    startTimeUnixNano: sample.timestampUnixNano,
  };
  const sampleBuckets = buildHistogramBuckets(sample.value);
  total.count += 1n;
  if (total.sum !== null) {
    const nextSum = total.sum + sample.value;
    total.sum = Number.isFinite(nextSum) ? nextSum : null;
  }
  for (let index = 0; index < total.bucketCounts.length; index += 1) {
    total.bucketCounts[index] = (total.bucketCounts[index] ?? 0n) +
      BigInt(sampleBuckets[index] ?? 0);
  }
  state.histogramTotals.set(totalKey, total);
  const dataPoint: Record<string, unknown> = {
    attributes: toOtlpAttributes(sample.attributes),
    startTimeUnixNano: total.startTimeUnixNano,
    timeUnixNano: sample.timestampUnixNano,
    count: String(total.count),
    explicitBounds: HISTOGRAM_BOUNDS,
    bucketCounts: total.bucketCounts.map(String),
  };
  if (total.sum !== null) dataPoint.sum = total.sum;
  group.dataPoints.set(seriesKey, dataPoint);
}

function buildMetric(group: MetricGroup): Record<string, unknown> {
  const metric: Record<string, unknown> = { name: group.name };
  if (group.options.description !== undefined) metric.description = group.options.description;
  if (group.options.unit !== undefined) metric.unit = group.options.unit;
  const dataPoints = [...group.dataPoints.values()];

  if (group.kind === "counter") {
    metric.sum = {
      dataPoints,
      aggregationTemporality: 2,
      isMonotonic: true,
    };
  } else if (group.kind === "histogram") {
    metric.histogram = {
      dataPoints,
      aggregationTemporality: 2,
    };
  } else {
    metric.gauge = { dataPoints };
  }
  return metric;
}

function buildDirectOtlpBody(
  state: DestinationState,
  samples: DirectMetricSample[],
): Record<string, unknown> {
  const groups = new Map<string, MetricGroup>();
  for (const sample of samples) {
    const { group, identity, seriesKey } = getMetricGroup(groups, sample);
    if (sample.kind === "counter") {
      addCounterSample(state, group, identity, seriesKey, sample);
    } else if (sample.kind === "histogram") {
      addHistogramSample(state, group, identity, seriesKey, sample);
    } else {
      group.dataPoints.set(seriesKey, {
        attributes: toOtlpAttributes(sample.attributes),
        timeUnixNano: sample.timestampUnixNano,
        asDouble: sample.value,
      });
    }
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: toOtlpAttributes(state.target.resourceAttributes),
      },
      scopeMetrics: [{
        scope: { name: "veryfront.project.metrics" },
        metrics: [...groups.values()].map(buildMetric),
      }],
    }],
  };
}

function releaseExportSlot(): void {
  const waiter = exportSlotWaiters.shift();
  if (waiter) {
    waiter(releaseExportSlot);
    return;
  }
  activeExportCount = Math.max(0, activeExportCount - 1);
}

async function acquireExportSlot(): Promise<ExportSlotRelease | null> {
  if (shutdownDeadlineReached) return null;
  if (activeExportCount < DIRECT_MAX_CONCURRENT_EXPORTS) {
    activeExportCount += 1;
    return releaseExportSlot;
  }
  return await new Promise<ExportSlotRelease | null>((resolve) => {
    exportSlotWaiters.push(resolve);
  });
}

function cancelPendingExportSlots(): void {
  for (const waiter of exportSlotWaiters.splice(0)) waiter(null);
}

function discardResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Response cleanup is best effort and does not change export success.
  }
}

async function exportOnce(
  target: DirectMetricsTarget,
  body: BodyInit,
  generation: number,
): Promise<ExportAttemptResult> {
  const releaseSlot = await acquireExportSlot();
  if (
    releaseSlot === null ||
    shutdownDeadlineReached ||
    generation !== exporterGeneration
  ) {
    releaseSlot?.();
    return { ok: false, retryable: false, reason: "shutdown" };
  }
  const controller = new AbortController();
  let resolveTimeout: (() => void) | undefined;
  const timedOut = new Promise<{ kind: "timeout" }>((resolve) => {
    resolveTimeout = () => resolve({ kind: "timeout" });
  });
  const cancelRequest = () => {
    resolveTimeout?.();
    controller.abort();
  };
  activeExportCancellations.set(controller, cancelRequest);
  const timeout = setTimeout(cancelRequest, target.timeoutMs);
  if (referencedTestFlushes === 0) unrefTimer(timeout);

  try {
    const requestHeaders = new Headers(target.headers);
    requestHeaders.set("Content-Type", "application/json");
    requestHeaders.set("User-Agent", "veryfront-metrics");
    if (target.compression === "gzip") {
      requestHeaders.set("Content-Encoding", "gzip");
    } else {
      requestHeaders.delete("Content-Encoding");
    }
    const request = Promise.resolve().then(() =>
      fetch(target.url, {
        method: "POST",
        headers: requestHeaders,
        body,
        redirect: "manual",
        signal: controller.signal,
      })
    ).then(
      (response) => ({ kind: "response" as const, response }),
      () => ({ kind: "network" as const }),
    );
    const outcome = await Promise.race([request, timedOut]);
    if (outcome.kind === "timeout") {
      void request.then((lateOutcome) => {
        if (lateOutcome.kind === "response") discardResponseBody(lateOutcome.response);
      });
      return { ok: false, retryable: true, reason: "network" };
    }
    if (outcome.kind === "network") {
      return { ok: false, retryable: true, reason: "network" };
    }

    const response = outcome.response;
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
    const result: ExportAttemptResult = response.ok
      ? { ok: true, retryable: false, reason: "success" }
      : {
        ok: false,
        retryable: RETRYABLE_STATUS_CODES.has(response.status),
        retryAfterMs,
        status: response.status,
        reason: "http",
      };
    discardResponseBody(response);
    return result;
  } catch {
    return { ok: false, retryable: true, reason: "network" };
  } finally {
    clearTimeout(timeout);
    activeExportCancellations.delete(controller);
    releaseSlot();
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  let delayMs: number;
  if (/^\d+$/.test(value.trim())) {
    delayMs = Number(value.trim()) * 1_000;
  } else {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return undefined;
    delayMs = timestamp - Date.now();
  }
  if (!Number.isFinite(delayMs)) return DIRECT_MAX_RETRY_DELAY_MS;
  return Math.min(Math.max(0, delayMs), DIRECT_MAX_RETRY_DELAY_MS);
}

function exponentialRetryDelay(attempt: number): number {
  const upperBound = Math.min(
    DIRECT_INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    DIRECT_MAX_RETRY_DELAY_MS,
  );
  const lowerBound = Math.floor(upperBound / 2);
  return lowerBound + Math.floor(Math.random() * (upperBound - lowerBound + 1));
}

async function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs === 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    if (referencedTestFlushes === 0) unrefTimer(timer);
  });
}

async function prepareExportBody(
  target: DirectMetricsTarget,
  body: string,
): Promise<BodyInit> {
  if (target.compression === "none") return body;
  const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function exportWithRetry(target: DirectMetricsTarget, body: string): Promise<void> {
  const generation = exporterGeneration;
  let requestBody: BodyInit;
  try {
    requestBody = await prepareExportBody(target, body);
  } catch {
    logDirectExporterEvent("compression-error");
    return;
  }
  if (shutdownDeadlineReached || generation !== exporterGeneration) return;

  let lastResult: ExportAttemptResult | null = null;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= DIRECT_MAX_EXPORT_ATTEMPTS; attempt += 1) {
    if (
      shutdownDeadlineReached ||
      generation !== exporterGeneration ||
      (attempt > 1 && shutdownRequested)
    ) break;
    attemptsMade = attempt;
    lastResult = await exportOnce(target, requestBody, generation);
    if (lastResult.ok) return;
    if (lastResult.reason === "shutdown") return;
    if (
      !lastResult.retryable ||
      attempt === DIRECT_MAX_EXPORT_ATTEMPTS ||
      shutdownRequested
    ) break;
    await waitForRetry(lastResult.retryAfterMs ?? exponentialRetryDelay(attempt));
  }

  if (shutdownDeadlineReached || generation !== exporterGeneration) return;
  logDirectExporterEvent(lastResult?.reason ?? "network", {
    attempts: attemptsMade,
    status: lastResult?.status,
  });
}

async function drainDestination(state: DestinationState): Promise<void> {
  cancelFlushTimer(state);
  while (state.queue.length > 0) {
    let batchSize = 0;
    let batchBytes = 0;
    while (batchSize < state.queue.length && batchSize < DIRECT_MAX_BATCH_SIZE) {
      const sampleBytes = state.queue[batchSize]?.estimatedSizeBytes ?? 0;
      if (batchSize > 0 && batchBytes + sampleBytes > DIRECT_MAX_BATCH_BYTES) break;
      batchBytes += sampleBytes;
      batchSize += 1;
    }
    const samples = state.queue.splice(0, Math.max(1, batchSize));
    state.queuedBytes = Math.max(
      0,
      state.queuedBytes - samples.reduce((total, sample) => total + sample.estimatedSizeBytes, 0),
    );
    const body = JSON.stringify(buildDirectOtlpBody(state, samples));
    await exportWithRetry(state.target, body);
  }
}

function requestDestinationDrain(state: DestinationState): Promise<void> {
  if (state.drainPromise) return state.drainPromise;
  const promise = drainDestination(state)
    .catch(() => logDirectExporterEvent("drain-error"))
    .finally(() => {
      if (state.drainPromise === promise) state.drainPromise = null;
      state.lastUsed = Date.now();
      if (state.queue.length > 0) scheduleDirectFlush(state);
    });
  state.drainPromise = promise;
  return promise;
}

async function flushAllDestinations(): Promise<void> {
  while (true) {
    const states = [...destinations.values()];
    if (states.length === 0) return;
    for (const state of states) cancelFlushTimer(state);
    await Promise.all(states.map(requestDestinationDrain));
    if (states.every((state) => state.queue.length === 0 && !state.drainPromise)) return;
  }
}

export async function flushDirectMetricsForTests(): Promise<void> {
  referencedTestFlushes += 1;
  try {
    await flushAllDestinations();
  } finally {
    referencedTestFlushes -= 1;
  }
}

export async function shutdownDirectMetrics(
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  shutdownRequested = true;
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? Math.min(timeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS)
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const flushing = flushAllDestinations();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    flushing.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), boundedTimeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (!completed) {
    shutdownDeadlineReached = true;
    cancelPendingExportSlots();
    for (const cancelRequest of activeExportCancellations.values()) cancelRequest();
    void flushing.catch(() => {});
  }
  for (const state of destinations.values()) disposeDestination(state);
  destinations.clear();
}

export function resetDirectMetricsForTests(): void {
  exporterGeneration += 1;
  shutdownDeadlineReached = true;
  cancelPendingExportSlots();
  for (const cancelRequest of activeExportCancellations.values()) cancelRequest();
  activeExportCancellations.clear();
  for (const state of destinations.values()) disposeDestination(state);
  destinations.clear();
  lastTimestampUnixNano = 0n;
  shutdownRequested = false;
  shutdownDeadlineReached = false;
}
