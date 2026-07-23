import type { MetricsInstruments, RuntimeState } from "./types.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";

const MAX_METRIC_ATTRIBUTES = 32;
const MAX_METRIC_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_METRIC_ATTRIBUTE_VALUE_LENGTH = 256;

function runMetricHook(hook: () => unknown): void {
  try {
    hook();
  } catch {
    // Metrics exporters must not affect application behavior.
  }
}

function normalizeObservation(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, Number.MAX_SAFE_INTEGER);
}

function normalizeCount(value: number): number {
  return Math.floor(normalizeObservation(value));
}

function incrementState(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, normalizeCount(value) + 1);
}

function sanitizeAttributes(
  attributes: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!attributes) return undefined;
  const sanitized: Record<string, string> = {};
  let count = 0;
  try {
    for (const [key, value] of Object.entries(attributes)) {
      if (count >= MAX_METRIC_ATTRIBUTES) break;
      if (
        typeof value !== "string" || key.length === 0 ||
        key.length > MAX_METRIC_ATTRIBUTE_KEY_LENGTH ||
        !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)
      ) {
        continue;
      }
      sanitized[key] = sanitizeUrlCredentials(value).slice(
        0,
        MAX_METRIC_ATTRIBUTE_VALUE_LENGTH,
      );
      count++;
    }
  } catch {
    return undefined;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export class MetricsRecorder {
  constructor(
    private _instruments: MetricsInstruments,
    private runtimeState: RuntimeState,
  ) {}

  /** Update instruments after late initialization */
  set instruments(instruments: MetricsInstruments) {
    this._instruments = instruments;
  }

  get instruments(): MetricsInstruments {
    return this._instruments;
  }

  recordHttpRequest(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    this.runtimeState.activeRequests = incrementState(this.runtimeState.activeRequests);
    runMetricHook(() => this.instruments.httpRequestCounter?.add(1, safeAttributes));
    runMetricHook(() => this.instruments.httpActiveRequests?.add(1, safeAttributes));
  }

  recordHttpRequestComplete(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    const safeAttributes = sanitizeAttributes(attributes);
    const hadActiveRequest = this.runtimeState.activeRequests > 0;
    this.runtimeState.activeRequests = Math.max(
      0,
      normalizeCount(this.runtimeState.activeRequests) - 1,
    );
    runMetricHook(() =>
      this.instruments.httpRequestDuration?.record(
        normalizeObservation(durationMs),
        safeAttributes,
      )
    );
    if (hadActiveRequest) {
      runMetricHook(() => this.instruments.httpActiveRequests?.add(-1, safeAttributes));
    }
  }

  recordCacheGet(hit: boolean, attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.cacheGetCounter?.add(1, safeAttributes));

    if (hit === true) {
      runMetricHook(() => this.instruments.cacheHitCounter?.add(1, safeAttributes));
    } else {
      runMetricHook(() => this.instruments.cacheMissCounter?.add(1, safeAttributes));
    }
  }

  recordCacheSet(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    this.runtimeState.cacheSize = incrementState(this.runtimeState.cacheSize);
    runMetricHook(() => this.instruments.cacheSetCounter?.add(1, safeAttributes));
  }

  recordCacheInvalidate(
    count: number,
    attributes?: Record<string, string>,
  ): void {
    const safeCount = normalizeCount(count);
    const safeAttributes = sanitizeAttributes(attributes);
    this.runtimeState.cacheSize = Math.max(
      0,
      normalizeCount(this.runtimeState.cacheSize) - safeCount,
    );
    runMetricHook(() => this.instruments.cacheInvalidateCounter?.add(safeCount, safeAttributes));
  }

  setCacheSize(size: number): void {
    this.runtimeState.cacheSize = normalizeCount(size);
  }

  recordRender(durationMs: number, attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.renderDuration?.record(normalizeObservation(durationMs), safeAttributes)
    );
    runMetricHook(() => this.instruments.renderCounter?.add(1, safeAttributes));
  }

  recordRenderError(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.renderErrorCounter?.add(1, safeAttributes));
  }

  recordRSCRender(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.rscRenderDuration?.record(normalizeObservation(durationMs), safeAttributes)
    );
  }

  recordRSCStream(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.rscStreamDuration?.record(normalizeObservation(durationMs), safeAttributes)
    );
  }

  recordRSCRequest(
    type: "manifest" | "page" | "stream" | "action",
    attributes?: Record<string, string>,
  ): void {
    const safeAttributes = sanitizeAttributes(attributes);
    switch (type) {
      case "manifest":
        runMetricHook(() => this.instruments.rscManifestCounter?.add(1, safeAttributes));
        return;
      case "page":
        runMetricHook(() => this.instruments.rscPageCounter?.add(1, safeAttributes));
        return;
      case "stream":
        runMetricHook(() => this.instruments.rscStreamCounter?.add(1, safeAttributes));
        return;
      case "action":
        runMetricHook(() => this.instruments.rscActionCounter?.add(1, safeAttributes));
        return;
    }
  }

  recordRSCError(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.rscErrorCounter?.add(1, safeAttributes));
  }

  recordBuild(durationMs: number, attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.buildDuration?.record(normalizeObservation(durationMs), safeAttributes)
    );
  }

  recordBundle(sizeKb: number, attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.bundleSizeHistogram?.record(normalizeObservation(sizeKb), safeAttributes)
    );
    runMetricHook(() => this.instruments.bundleCounter?.add(1, safeAttributes));
  }

  recordDataFetch(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() =>
      this.instruments.dataFetchDuration?.record(normalizeObservation(durationMs), safeAttributes)
    );
    runMetricHook(() => this.instruments.dataFetchCounter?.add(1, safeAttributes));
  }

  recordDataFetchError(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.dataFetchErrorCounter?.add(1, safeAttributes));
  }

  recordCorsRejection(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.corsRejectionCounter?.add(1, safeAttributes));
  }

  recordSecurityHeaders(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.securityHeadersCounter?.add(1, safeAttributes));
  }

  recordError(attributes?: Record<string, string>): void {
    const safeAttributes = sanitizeAttributes(attributes);
    runMetricHook(() => this.instruments.errorCounter?.add(1, safeAttributes));
  }
}
