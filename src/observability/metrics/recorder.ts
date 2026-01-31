import type { MetricsInstruments, RuntimeState } from "./types.ts";

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
    this.instruments.httpRequestCounter?.add(1, attributes);
    this.instruments.httpActiveRequests?.add(1, attributes);
    this.runtimeState.activeRequests++;
  }

  recordHttpRequestComplete(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    this.instruments.httpRequestDuration?.record(durationMs, attributes);
    this.instruments.httpActiveRequests?.add(-1, attributes);
    this.runtimeState.activeRequests--;
  }

  recordCacheGet(hit: boolean, attributes?: Record<string, string>): void {
    this.instruments.cacheGetCounter?.add(1, attributes);

    if (hit) {
      this.instruments.cacheHitCounter?.add(1, attributes);
    } else {
      this.instruments.cacheMissCounter?.add(1, attributes);
    }
  }

  recordCacheSet(attributes?: Record<string, string>): void {
    this.instruments.cacheSetCounter?.add(1, attributes);
    this.runtimeState.cacheSize++;
  }

  recordCacheInvalidate(
    count: number,
    attributes?: Record<string, string>,
  ): void {
    this.instruments.cacheInvalidateCounter?.add(count, attributes);
    this.runtimeState.cacheSize = Math.max(0, this.runtimeState.cacheSize - count);
  }

  setCacheSize(size: number): void {
    this.runtimeState.cacheSize = size;
  }

  recordRender(durationMs: number, attributes?: Record<string, string>): void {
    this.instruments.renderDuration?.record(durationMs, attributes);
    this.instruments.renderCounter?.add(1, attributes);
  }

  recordRenderError(attributes?: Record<string, string>): void {
    this.instruments.renderErrorCounter?.add(1, attributes);
  }

  recordRSCRender(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    this.instruments.rscRenderDuration?.record(durationMs, attributes);
  }

  recordRSCStream(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    this.instruments.rscStreamDuration?.record(durationMs, attributes);
  }

  recordRSCRequest(
    type: "manifest" | "page" | "stream" | "action",
    attributes?: Record<string, string>,
  ): void {
    switch (type) {
      case "manifest":
        this.instruments.rscManifestCounter?.add(1, attributes);
        return;
      case "page":
        this.instruments.rscPageCounter?.add(1, attributes);
        return;
      case "stream":
        this.instruments.rscStreamCounter?.add(1, attributes);
        return;
      case "action":
        this.instruments.rscActionCounter?.add(1, attributes);
        return;
    }
  }

  recordRSCError(attributes?: Record<string, string>): void {
    this.instruments.rscErrorCounter?.add(1, attributes);
  }

  recordBuild(durationMs: number, attributes?: Record<string, string>): void {
    this.instruments.buildDuration?.record(durationMs, attributes);
  }

  recordBundle(sizeKb: number, attributes?: Record<string, string>): void {
    this.instruments.bundleSizeHistogram?.record(sizeKb, attributes);
    this.instruments.bundleCounter?.add(1, attributes);
  }

  recordDataFetch(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    this.instruments.dataFetchDuration?.record(durationMs, attributes);
    this.instruments.dataFetchCounter?.add(1, attributes);
  }

  recordDataFetchError(attributes?: Record<string, string>): void {
    this.instruments.dataFetchErrorCounter?.add(1, attributes);
  }

  recordCorsRejection(attributes?: Record<string, string>): void {
    this.instruments.corsRejectionCounter?.add(1, attributes);
  }

  recordSecurityHeaders(attributes?: Record<string, string>): void {
    this.instruments.securityHeadersCounter?.add(1, attributes);
  }
}
