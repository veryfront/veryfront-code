import type { AttributeValue } from "#veryfront/observability";

export type DirectMetricKind = "counter" | "histogram" | "gauge";
export type DirectMetricTemporality = "cumulative" | "delta";

export interface DirectMetricInstrumentOptions {
  description?: string;
  unit?: string;
}

export interface DirectMetricsTarget {
  url: string;
  headers: Readonly<Record<string, string>>;
  resourceAttributes: Readonly<Record<string, AttributeValue>>;
  temporality: DirectMetricTemporality;
}

export interface DirectMetricRecord {
  kind: DirectMetricKind;
  name: string;
  value: number;
  attributes: Readonly<Record<string, AttributeValue>>;
  options: DirectMetricInstrumentOptions;
  timestampUnixNano: string;
  target: DirectMetricsTarget;
}

type DirectExporterLogger = (message: string, error?: unknown) => void;
type TimerHandle = ReturnType<typeof setTimeout>;

interface DirectSeriesBase {
  attributes: Readonly<Record<string, AttributeValue>>;
  description?: string;
  dirty: boolean;
  key: string;
  kind: DirectMetricKind;
  name: string;
  revision: number;
  startTimeUnixNano: string;
  timeUnixNano: string;
  unit?: string;
}

interface DirectCounterSeries extends DirectSeriesBase {
  kind: "counter";
  value: number;
}

interface DirectHistogramSeries extends DirectSeriesBase {
  kind: "histogram";
  bucketCounts: number[];
  count: number;
  sum: number;
}

interface DirectGaugeSeries extends DirectSeriesBase {
  kind: "gauge";
  value: number;
}

type DirectMetricSeries =
  | DirectCounterSeries
  | DirectHistogramSeries
  | DirectGaugeSeries;

interface DirectMetricSnapshot {
  counterValue?: number;
  histogramValue?: {
    bucketCounts: number[];
    count: number;
    sum: number;
  };
  key: string;
  kind: DirectMetricKind;
  metric: Record<string, unknown>;
  revision: number;
  timeUnixNano: string;
}

interface DirectDestinationState {
  active: boolean;
  abortController: AbortController | null;
  definitions: Map<string, string>;
  inFlight: Promise<boolean> | null;
  key: string;
  lastUsed: number;
  retryAttempts: number;
  scopeSeriesCounts: Map<string, number>;
  series: Map<string, DirectMetricSeries>;
  target: DirectMetricsTarget;
  timer: TimerHandle | null;
}

const DIRECT_FLUSH_DELAY_MS = 1_000;
const DIRECT_EXPORT_TIMEOUT_MS = 10_000;
const DIRECT_MAX_BATCH_SIZE = 100;
const DIRECT_MAX_DESTINATIONS = 16;
const DIRECT_MAX_SERIES_PER_SCOPE = 1_000;
const DIRECT_MAX_SERIES_PER_DESTINATION = 10_000;
const DIRECT_MAX_PAYLOAD_BYTES = 1_048_576;
const DIRECT_MAX_RETRY_ATTEMPTS = 5;
const DIRECT_MAX_RETRY_DELAY_MS = 30_000;
const DIRECT_RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const HISTOGRAM_BOUNDS = [0, 10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const OTLP_SCOPE_NAME = "veryfront.project.metrics";
const textEncoder = new TextEncoder();

function sortedEntries<T>(record: Readonly<Record<string, T>>): Array<[string, T]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function attributesKey(attributes: Readonly<Record<string, AttributeValue>>): string {
  return JSON.stringify(sortedEntries(attributes));
}

function targetKey(target: DirectMetricsTarget): string {
  return JSON.stringify([
    target.url,
    sortedEntries(target.headers),
    sortedEntries(target.resourceAttributes),
    target.temporality,
  ]);
}

function seriesKey(record: DirectMetricRecord): string {
  return JSON.stringify([
    record.kind,
    record.name,
    record.options.description ?? "",
    record.options.unit ?? "",
    attributesKey(record.attributes),
  ]);
}

function definitionKey(record: DirectMetricRecord): string {
  return JSON.stringify([
    record.kind,
    record.name,
    record.attributes.project_id ?? "",
    record.attributes.project_slug ?? "",
  ]);
}

function definitionValue(record: DirectMetricRecord): string {
  return JSON.stringify([
    record.options.description ?? "",
    record.options.unit ?? "",
  ]);
}

function scopeKey(record: DirectMetricRecord): string {
  return JSON.stringify([
    record.attributes.project_id ?? "",
    record.attributes.project_slug ?? "",
  ]);
}

function toOtlpValue(value: AttributeValue): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return { doubleValue: value };
  return { stringValue: String(value) };
}

function toOtlpAttributes(
  attributes: Readonly<Record<string, AttributeValue>>,
): Array<Record<string, unknown>> {
  return sortedEntries(attributes).map(([key, value]) => ({
    key,
    value: toOtlpValue(value),
  }));
}

function buildHistogramBuckets(value: number): number[] {
  const counts = new Array(HISTOGRAM_BOUNDS.length + 1).fill(0);
  const bucketIndex = HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
  counts[bucketIndex === -1 ? counts.length - 1 : bucketIndex] = 1;
  return counts;
}

function nextRevision(current: number): number {
  return current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
}

function copyTarget(target: DirectMetricsTarget): DirectMetricsTarget {
  return {
    url: target.url,
    headers: Object.freeze(Object.fromEntries(sortedEntries(target.headers))),
    resourceAttributes: Object.freeze(
      Object.fromEntries(sortedEntries(target.resourceAttributes)),
    ),
    temporality: target.temporality,
  };
}

function createSeries(record: DirectMetricRecord, key: string): DirectMetricSeries {
  const base: DirectSeriesBase = {
    attributes: Object.freeze(Object.fromEntries(sortedEntries(record.attributes))),
    description: record.options.description,
    dirty: true,
    key,
    kind: record.kind,
    name: record.name,
    revision: 1,
    startTimeUnixNano: record.timestampUnixNano,
    timeUnixNano: record.timestampUnixNano,
    unit: record.options.unit,
  };

  if (record.kind === "counter") {
    return { ...base, kind: "counter", value: record.value };
  }
  if (record.kind === "histogram") {
    return {
      ...base,
      kind: "histogram",
      bucketCounts: buildHistogramBuckets(record.value),
      count: 1,
      sum: record.value,
    };
  }
  return { ...base, kind: "gauge", value: record.value };
}

function updateSeries(series: DirectMetricSeries, record: DirectMetricRecord): boolean {
  if (series.kind === "counter") {
    const nextValue = series.value + record.value;
    if (!Number.isFinite(nextValue)) return false;
    series.value = nextValue;
  } else if (series.kind === "histogram") {
    const nextSum = series.sum + record.value;
    if (
      !Number.isFinite(nextSum) ||
      series.count >= Number.MAX_SAFE_INTEGER
    ) {
      return false;
    }
    const sampleBuckets = buildHistogramBuckets(record.value);
    series.count += 1;
    series.sum = nextSum;
    for (let index = 0; index < series.bucketCounts.length; index++) {
      series.bucketCounts[index] = (series.bucketCounts[index] ?? 0) + (sampleBuckets[index] ?? 0);
    }
  } else {
    series.value = record.value;
  }

  series.timeUnixNano = record.timestampUnixNano;
  series.revision = nextRevision(series.revision);
  series.dirty = true;
  return true;
}

function snapshotSeries(
  series: DirectMetricSeries,
  temporality: DirectMetricTemporality,
): DirectMetricSnapshot {
  const attributes = toOtlpAttributes(series.attributes);
  const aggregationTemporality = temporality === "delta" ? 1 : 2;
  const identity = {
    name: series.name,
    ...(series.description === undefined ? {} : { description: series.description }),
    ...(series.unit === undefined ? {} : { unit: series.unit }),
  };

  if (series.kind === "counter") {
    return {
      counterValue: series.value,
      key: series.key,
      kind: series.kind,
      revision: series.revision,
      timeUnixNano: series.timeUnixNano,
      metric: {
        ...identity,
        sum: {
          dataPoints: [{
            attributes,
            startTimeUnixNano: series.startTimeUnixNano,
            timeUnixNano: series.timeUnixNano,
            asDouble: series.value,
          }],
          aggregationTemporality,
          isMonotonic: true,
        },
      },
    };
  }

  if (series.kind === "histogram") {
    return {
      histogramValue: {
        bucketCounts: [...series.bucketCounts],
        count: series.count,
        sum: series.sum,
      },
      key: series.key,
      kind: series.kind,
      revision: series.revision,
      timeUnixNano: series.timeUnixNano,
      metric: {
        ...identity,
        histogram: {
          dataPoints: [{
            attributes,
            startTimeUnixNano: series.startTimeUnixNano,
            timeUnixNano: series.timeUnixNano,
            count: String(series.count),
            sum: series.sum,
            explicitBounds: HISTOGRAM_BOUNDS,
            bucketCounts: series.bucketCounts.map(String),
          }],
          aggregationTemporality,
        },
      },
    };
  }

  return {
    key: series.key,
    kind: series.kind,
    revision: series.revision,
    timeUnixNano: series.timeUnixNano,
    metric: {
      ...identity,
      gauge: {
        dataPoints: [{
          attributes,
          timeUnixNano: series.timeUnixNano,
          asDouble: series.value,
        }],
      },
    },
  };
}

function buildOtlpBody(
  target: DirectMetricsTarget,
  snapshots: DirectMetricSnapshot[],
): Record<string, unknown> {
  return {
    resourceMetrics: [{
      resource: {
        attributes: toOtlpAttributes(target.resourceAttributes),
      },
      scopeMetrics: [{
        scope: { name: OTLP_SCOPE_NAME },
        metrics: snapshots.map((snapshot) => snapshot.metric),
      }],
    }],
  };
}

function unrefTimer(timer: TimerHandle): void {
  try {
    if (typeof timer === "number") {
      Deno.unrefTimer(timer);
    } else {
      (timer as { unref?: () => void }).unref?.();
    }
  } catch {
    // Some runtimes do not expose unref support.
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value || value.length > 128) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, DIRECT_MAX_RETRY_DELAY_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(
    Math.max(0, timestamp - Date.now()),
    DIRECT_MAX_RETRY_DELAY_MS,
  );
}

function cancelResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Releasing an exporter response body is best effort.
  }
}

export class DirectMetricsExporter {
  readonly #destinations = new Map<string, DirectDestinationState>();
  readonly #log: DirectExporterLogger;
  #sequence = 0;

  constructor(log: DirectExporterLogger) {
    this.#log = log;
  }

  record(record: DirectMetricRecord): void {
    const destinationKey = targetKey(record.target);
    let destination = this.#destinations.get(destinationKey);
    if (!destination) {
      if (
        this.#destinations.size >= DIRECT_MAX_DESTINATIONS &&
        !this.#evictOldestIdleDestination()
      ) {
        this.#log("destination cardinality limit reached");
        return;
      }
      destination = {
        active: true,
        abortController: null,
        definitions: new Map(),
        inFlight: null,
        key: destinationKey,
        lastUsed: ++this.#sequence,
        retryAttempts: 0,
        scopeSeriesCounts: new Map(),
        series: new Map(),
        target: copyTarget(record.target),
        timer: null,
      };
      this.#destinations.set(destinationKey, destination);
    } else {
      destination.lastUsed = ++this.#sequence;
    }

    const metricDefinitionKey = definitionKey(record);
    const metricDefinitionValue = definitionValue(record);
    const existingDefinition = destination.definitions.get(metricDefinitionKey);
    if (
      existingDefinition !== undefined &&
      existingDefinition !== metricDefinitionValue
    ) {
      this.#log("conflicting metric metadata definition");
      return;
    }

    const key = seriesKey(record);
    const existing = destination.series.get(key);
    if (existing) {
      if (!updateSeries(existing, record)) {
        this.#log("cumulative metric value exceeded numeric limits");
        return;
      }
    } else {
      const recordScopeKey = scopeKey(record);
      const scopeSeriesCount = destination.scopeSeriesCounts.get(recordScopeKey) ?? 0;
      if (
        scopeSeriesCount >= DIRECT_MAX_SERIES_PER_SCOPE ||
        destination.series.size >= DIRECT_MAX_SERIES_PER_DESTINATION
      ) {
        this.#log("series cardinality limit reached");
        return;
      }
      if (existingDefinition === undefined) {
        destination.definitions.set(metricDefinitionKey, metricDefinitionValue);
      }
      destination.series.set(key, createSeries(record, key));
      destination.scopeSeriesCounts.set(recordScopeKey, scopeSeriesCount + 1);
    }

    if (destination.retryAttempts >= DIRECT_MAX_RETRY_ATTEMPTS) {
      destination.retryAttempts = 0;
    }

    if (this.#dirtyCount(destination) >= DIRECT_MAX_BATCH_SIZE) {
      void this.#flushDestination(destination);
      return;
    }
    this.#schedule(destination, DIRECT_FLUSH_DELAY_MS);
  }

  async flush(): Promise<void> {
    await Promise.all(
      [...this.#destinations.values()].map((destination) => this.#flushDestination(destination)),
    );
  }

  reset(): void {
    for (const destination of this.#destinations.values()) {
      destination.active = false;
      if (destination.timer) clearTimeout(destination.timer);
      destination.timer = null;
      destination.abortController?.abort(
        new DOMException("Metrics exporter reset", "AbortError"),
      );
      destination.abortController = null;
    }
    this.#destinations.clear();
    this.#sequence = 0;
  }

  #evictOldestIdleDestination(): boolean {
    let oldest: DirectDestinationState | undefined;
    for (const destination of this.#destinations.values()) {
      const dirty = this.#dirtyCount(destination);
      if (
        destination.inFlight ||
        destination.timer ||
        (dirty > 0 && destination.retryAttempts < DIRECT_MAX_RETRY_ATTEMPTS)
      ) {
        continue;
      }
      if (!oldest || destination.lastUsed < oldest.lastUsed) {
        oldest = destination;
      }
    }
    if (!oldest) return false;
    if (this.#dirtyCount(oldest) > 0) {
      this.#log("evicting destination after retry limit was exhausted");
    }
    oldest.active = false;
    this.#destinations.delete(oldest.key);
    return true;
  }

  #dirtyCount(destination: DirectDestinationState): number {
    let count = 0;
    for (const series of destination.series.values()) {
      if (series.dirty) count++;
    }
    return count;
  }

  #schedule(destination: DirectDestinationState, delayMs: number): void {
    if (!destination.active || destination.timer) return;
    destination.timer = setTimeout(() => {
      destination.timer = null;
      void this.#flushDestination(destination);
    }, delayMs);
    unrefTimer(destination.timer);
  }

  async #flushDestination(destination: DirectDestinationState): Promise<void> {
    if (!destination.active) return;
    if (destination.inFlight) {
      const succeeded = await destination.inFlight;
      if (destination.active && succeeded && this.#dirtyCount(destination) > 0) {
        await this.#flushDestination(destination);
      }
      return;
    }

    while (destination.active && this.#dirtyCount(destination) > 0) {
      const attempt = this.#flushBatch(destination);
      destination.inFlight = attempt;
      const succeeded = await attempt;
      if (destination.inFlight === attempt) destination.inFlight = null;
      if (!succeeded) return;
    }
  }

  async #flushBatch(destination: DirectDestinationState): Promise<boolean> {
    if (destination.timer) {
      clearTimeout(destination.timer);
      destination.timer = null;
    }

    const dirtySeries = [...destination.series.values()]
      .filter((series) => series.dirty)
      .slice(0, DIRECT_MAX_BATCH_SIZE);
    if (dirtySeries.length === 0) return true;

    const snapshots = dirtySeries.map((series) =>
      snapshotSeries(series, destination.target.temporality)
    );
    let payload = JSON.stringify(buildOtlpBody(destination.target, snapshots));
    while (
      textEncoder.encode(payload).byteLength > DIRECT_MAX_PAYLOAD_BYTES &&
      snapshots.length > 1
    ) {
      snapshots.pop();
      payload = JSON.stringify(buildOtlpBody(destination.target, snapshots));
    }

    if (textEncoder.encode(payload).byteLength > DIRECT_MAX_PAYLOAD_BYTES) {
      const oversized = snapshots[0];
      const current = oversized && destination.series.get(oversized.key);
      if (current && oversized && current.revision === oversized.revision) {
        current.dirty = false;
      }
      this.#log("single-series payload exceeded the exporter byte limit");
      return true;
    }

    const controller = new AbortController();
    destination.abortController = controller;
    let timeout!: TimerHandle;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new DOMException("Metrics export timed out", "TimeoutError");
        controller.abort(error);
        reject(error);
      }, DIRECT_EXPORT_TIMEOUT_MS);
    });
    unrefTimer(timeout);

    try {
      const request = fetch(destination.target.url, {
        method: "POST",
        headers: {
          ...destination.target.headers,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      });
      void request.then((response) => {
        if (controller.signal.aborted) cancelResponseBody(response);
      }).catch(() => {});
      const response = await Promise.race([request, timeoutFailure]);
      cancelResponseBody(response);
      if (response.status !== 200) {
        if (DIRECT_RETRYABLE_STATUS_CODES.has(response.status)) {
          this.#recordFailure(
            destination,
            `HTTP ${response.status}`,
            undefined,
            parseRetryAfterMs(response.headers.get("retry-after")),
          );
          return false;
        }

        this.#log(`non-retryable HTTP ${response.status}`);
        this.#commitSnapshots(destination, snapshots);
        destination.retryAttempts = 0;
        return true;
      }

      this.#commitSnapshots(destination, snapshots);
      destination.retryAttempts = 0;
      return true;
    } catch (error) {
      this.#recordFailure(destination, "request failed", error);
      return false;
    } finally {
      clearTimeout(timeout);
      if (destination.abortController === controller) {
        destination.abortController = null;
      }
    }
  }

  #commitSnapshots(
    destination: DirectDestinationState,
    snapshots: DirectMetricSnapshot[],
  ): void {
    for (const snapshot of snapshots) {
      const current = destination.series.get(snapshot.key);
      if (!current || current.kind !== snapshot.kind) continue;
      const unchanged = current.revision === snapshot.revision;

      if (
        destination.target.temporality === "delta" &&
        current.kind === "counter" &&
        snapshot.counterValue !== undefined
      ) {
        current.value = unchanged ? 0 : Math.max(0, current.value - snapshot.counterValue);
        current.startTimeUnixNano = snapshot.timeUnixNano;
        current.dirty = !unchanged;
        continue;
      }

      if (
        destination.target.temporality === "delta" &&
        current.kind === "histogram" &&
        snapshot.histogramValue
      ) {
        current.count = unchanged ? 0 : Math.max(0, current.count - snapshot.histogramValue.count);
        current.sum = unchanged ? 0 : current.sum - snapshot.histogramValue.sum;
        current.bucketCounts = current.bucketCounts.map((count, index) =>
          unchanged ? 0 : Math.max(
            0,
            count - (snapshot.histogramValue?.bucketCounts[index] ?? 0),
          )
        );
        current.startTimeUnixNano = snapshot.timeUnixNano;
        current.dirty = !unchanged;
        continue;
      }

      if (unchanged) current.dirty = false;
    }
  }

  #recordFailure(
    destination: DirectDestinationState,
    message: string,
    error?: unknown,
    retryDelayMs?: number,
  ): void {
    destination.retryAttempts++;
    this.#log(message, error);
    if (
      !destination.active ||
      destination.retryAttempts >= DIRECT_MAX_RETRY_ATTEMPTS
    ) {
      return;
    }

    const delay = retryDelayMs ??
      Math.min(
        DIRECT_FLUSH_DELAY_MS * 2 ** (destination.retryAttempts - 1),
        DIRECT_MAX_RETRY_DELAY_MS,
      );
    this.#schedule(destination, delay);
  }
}
