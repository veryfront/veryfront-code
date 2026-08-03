import type { MetricsInstruments, RuntimeState } from "./types.ts";
import { sanitizeTelemetryAttributes } from "../telemetry-error.ts";
import { nonNegativeFiniteMeasure, nonNegativeSafeInteger, saturatingAdd } from "./numeric.ts";

function safelyRecord(operation: () => void): void {
  try {
    operation();
  } catch (_) {
    /* expected: a telemetry backend failure must not affect application work */
  }
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
    attributes = sanitizeTelemetryAttributes(attributes);
    this.runtimeState.activeRequests = saturatingAdd(this.runtimeState.activeRequests);
    safelyRecord(() => this.instruments.httpRequestCounter?.add(1, attributes));
    safelyRecord(() => this.instruments.httpActiveRequests?.add(1, attributes));
  }

  recordHttpRequestComplete(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    const activeRequests = nonNegativeSafeInteger(this.runtimeState.activeRequests);
    const hadActiveRequest = activeRequests > 0;
    this.runtimeState.activeRequests = hadActiveRequest ? activeRequests - 1 : 0;
    safelyRecord(() =>
      this.instruments.httpRequestDuration?.record(
        nonNegativeFiniteMeasure(durationMs),
        attributes,
      )
    );
    if (hadActiveRequest) {
      safelyRecord(() => this.instruments.httpActiveRequests?.add(-1, attributes));
    }
  }

  recordCacheGet(hit: boolean, attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.cacheGetCounter?.add(1, attributes));

    if (hit) {
      safelyRecord(() => this.instruments.cacheHitCounter?.add(1, attributes));
    } else {
      safelyRecord(() => this.instruments.cacheMissCounter?.add(1, attributes));
    }
  }

  recordCacheSet(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    this.runtimeState.cacheSize = saturatingAdd(this.runtimeState.cacheSize);
    safelyRecord(() => this.instruments.cacheSetCounter?.add(1, attributes));
  }

  recordCacheInvalidate(
    count: number,
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    const normalizedCount = nonNegativeSafeInteger(count);
    if (normalizedCount === 0) return;
    const cacheSize = nonNegativeSafeInteger(this.runtimeState.cacheSize);
    this.runtimeState.cacheSize = Math.max(0, cacheSize - normalizedCount);
    safelyRecord(() => this.instruments.cacheInvalidateCounter?.add(normalizedCount, attributes));
  }

  setCacheSize(size: number): void {
    this.runtimeState.cacheSize = nonNegativeSafeInteger(size);
  }

  recordRender(durationMs: number, attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.renderDuration?.record(nonNegativeFiniteMeasure(durationMs), attributes)
    );
    safelyRecord(() => this.instruments.renderCounter?.add(1, attributes));
  }

  recordRenderError(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.renderErrorCounter?.add(1, attributes));
  }

  recordRSCRender(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.rscRenderDuration?.record(
        nonNegativeFiniteMeasure(durationMs),
        attributes,
      )
    );
  }

  recordRSCStream(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.rscStreamDuration?.record(
        nonNegativeFiniteMeasure(durationMs),
        attributes,
      )
    );
  }

  recordRSCRequest(
    type: "manifest" | "page" | "stream" | "action",
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    switch (type) {
      case "manifest":
        safelyRecord(() => this.instruments.rscManifestCounter?.add(1, attributes));
        return;
      case "page":
        safelyRecord(() => this.instruments.rscPageCounter?.add(1, attributes));
        return;
      case "stream":
        safelyRecord(() => this.instruments.rscStreamCounter?.add(1, attributes));
        return;
      case "action":
        safelyRecord(() => this.instruments.rscActionCounter?.add(1, attributes));
        return;
    }
  }

  recordRSCError(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.rscErrorCounter?.add(1, attributes));
  }

  recordBuild(durationMs: number, attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.buildDuration?.record(nonNegativeFiniteMeasure(durationMs), attributes)
    );
  }

  recordBundle(sizeKb: number, attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.bundleSizeHistogram?.record(
        nonNegativeFiniteMeasure(sizeKb),
        attributes,
      )
    );
    safelyRecord(() => this.instruments.bundleCounter?.add(1, attributes));
  }

  recordDependencyArtifactBuild(
    input: {
      event: "claim" | "success" | "failure";
      durationMs?: number;
      totalBytes?: number;
      assetCount?: number;
      remainingExternalImportCount?: number;
      failureCode?: string;
    },
  ): void {
    const attributes = sanitizeTelemetryAttributes({
      event: input.event,
      ...(input.failureCode ? { failure_code: input.failureCode } : {}),
    });
    safelyRecord(() => this.instruments.dependencyArtifactBuildCounter?.add(1, attributes));
    const durationMs = input.durationMs;
    if (durationMs !== undefined) {
      safelyRecord(() =>
        this.instruments.dependencyArtifactBuildDuration?.record(
          nonNegativeFiniteMeasure(durationMs),
          attributes,
        )
      );
    }
    const totalBytes = input.totalBytes;
    if (totalBytes !== undefined) {
      safelyRecord(() =>
        this.instruments.dependencyArtifactBuildBytes?.record(
          nonNegativeSafeInteger(totalBytes),
          attributes,
        )
      );
    }
    const assetCount = input.assetCount;
    if (assetCount !== undefined) {
      safelyRecord(() =>
        this.instruments.dependencyArtifactBuildAssetCount?.record(
          nonNegativeSafeInteger(assetCount),
          attributes,
        )
      );
    }
    const remainingExternalImportCount = input.remainingExternalImportCount;
    if (remainingExternalImportCount !== undefined) {
      safelyRecord(() =>
        this.instruments.dependencyArtifactBuildExternalImportCount?.record(
          nonNegativeSafeInteger(remainingExternalImportCount),
          attributes,
        )
      );
    }
  }

  recordDataFetch(
    durationMs: number,
    attributes?: Record<string, string>,
  ): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() =>
      this.instruments.dataFetchDuration?.record(
        nonNegativeFiniteMeasure(durationMs),
        attributes,
      )
    );
    safelyRecord(() => this.instruments.dataFetchCounter?.add(1, attributes));
  }

  recordDataFetchError(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.dataFetchErrorCounter?.add(1, attributes));
  }

  recordCorsRejection(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.corsRejectionCounter?.add(1, attributes));
  }

  recordSecurityHeaders(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.securityHeadersCounter?.add(1, attributes));
  }

  recordError(attributes?: Record<string, string>): void {
    attributes = sanitizeTelemetryAttributes(attributes);
    safelyRecord(() => this.instruments.errorCounter?.add(1, attributes));
  }

  recordStreamLifecycleOutcome(attributes: Record<string, string>): void {
    this.instruments.streamLifecycleOutcomeCounter?.add(1, attributes);
  }

  recordStreamLifecycleDeadline(attributes: Record<string, string>): void {
    this.instruments.streamLifecycleDeadlineCounter?.add(1, attributes);
  }

  recordStreamLifecycleTelemetry(attributes: Record<string, string>): void {
    this.instruments.streamLifecycleTelemetryCounter?.add(1, attributes);
  }

  recordStreamLifecycleRepair(attributes: Record<string, string>): void {
    this.instruments.streamLifecycleRepairCounter?.add(1, attributes);
  }

  recordStreamLifecycleShadowDivergence(
    attributes: Record<string, string>,
  ): void {
    this.instruments.streamLifecycleShadowDivergenceCounter?.add(1, attributes);
  }

  recordStreamLifecycleDuration(
    kind:
      | "attempt"
      | "first_progress"
      | "semantic_idle"
      | "tool_input"
      | "tool_execution",
    durationMs: number,
    attributes: Record<string, string>,
  ): void {
    const value = Math.max(0, durationMs);
    switch (kind) {
      case "attempt":
        this.instruments.streamLifecycleAttemptDuration?.record(
          value,
          attributes,
        );
        return;
      case "first_progress":
        this.instruments.streamLifecycleFirstProgressDuration?.record(
          value,
          attributes,
        );
        return;
      case "semantic_idle":
        this.instruments.streamLifecycleSemanticIdleDuration?.record(
          value,
          attributes,
        );
        return;
      case "tool_input":
        this.instruments.streamLifecycleToolInputDuration?.record(
          value,
          attributes,
        );
        return;
      case "tool_execution":
        this.instruments.streamLifecycleToolExecutionDuration?.record(
          value,
          attributes,
        );
        return;
    }
  }
}
