import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MetricsRecorder } from "./recorder.ts";
import type { MetricsInstruments, RuntimeState } from "./types.ts";

interface MockCounter {
  _value: number;
  _lastAttributes?: Record<string, string>;
  add(value: number, attributes?: Record<string, string>): void;
}

interface MockHistogram {
  _value: number;
  _lastAttributes?: Record<string, string>;
  record(value: number, attributes?: Record<string, string>): void;
}

function createMockCounter(): MockCounter {
  return {
    _value: 0,
    _lastAttributes: undefined,
    add(value: number, attributes?: Record<string, string>) {
      this._value += value;
      this._lastAttributes = attributes;
    },
  };
}

function createMockHistogram(): MockHistogram {
  return {
    _value: 0,
    _lastAttributes: undefined,
    record(value: number, attributes?: Record<string, string>) {
      this._value = value;
      this._lastAttributes = attributes;
    },
  };
}

function createMockInstruments(): MetricsInstruments & {
  _httpRequestCounter: MockCounter;
  _httpRequestDuration: MockHistogram;
  _httpActiveRequests: MockCounter;
  _cacheGetCounter: MockCounter;
  _cacheHitCounter: MockCounter;
  _cacheMissCounter: MockCounter;
  _cacheSetCounter: MockCounter;
  _cacheInvalidateCounter: MockCounter;
  _renderDuration: MockHistogram;
  _renderCounter: MockCounter;
  _renderErrorCounter: MockCounter;
  _rscRenderDuration: MockHistogram;
  _rscStreamDuration: MockHistogram;
  _rscManifestCounter: MockCounter;
  _rscPageCounter: MockCounter;
  _rscStreamCounter: MockCounter;
  _rscActionCounter: MockCounter;
  _rscErrorCounter: MockCounter;
  _buildDuration: MockHistogram;
  _bundleSizeHistogram: MockHistogram;
  _bundleCounter: MockCounter;
  _dependencyArtifactBuildCounter: MockCounter;
  _dependencyArtifactBuildDuration: MockHistogram;
  _dependencyArtifactBuildBytes: MockHistogram;
  _dependencyArtifactBuildAssetCount: MockHistogram;
  _dependencyArtifactBuildExternalImportCount: MockHistogram;
  _dataFetchDuration: MockHistogram;
  _dataFetchCounter: MockCounter;
  _dataFetchErrorCounter: MockCounter;
  _corsRejectionCounter: MockCounter;
  _securityHeadersCounter: MockCounter;
  _errorCounter: MockCounter;
  _streamLifecycleOutcomeCounter: MockCounter;
  _streamLifecycleDeadlineCounter: MockCounter;
  _streamLifecycleTelemetryCounter: MockCounter;
  _streamLifecycleRepairCounter: MockCounter;
  _streamLifecycleShadowDivergenceCounter: MockCounter;
  _streamLifecycleAttemptDuration: MockHistogram;
  _streamLifecycleFirstProgressDuration: MockHistogram;
  _streamLifecycleSemanticIdleDuration: MockHistogram;
  _streamLifecycleToolInputDuration: MockHistogram;
  _streamLifecycleToolExecutionDuration: MockHistogram;
} {
  const httpRequestCounter = createMockCounter();
  const httpRequestDuration = createMockHistogram();
  const httpActiveRequests = createMockCounter();
  const cacheGetCounter = createMockCounter();
  const cacheHitCounter = createMockCounter();
  const cacheMissCounter = createMockCounter();
  const cacheSetCounter = createMockCounter();
  const cacheInvalidateCounter = createMockCounter();
  const renderDuration = createMockHistogram();
  const renderCounter = createMockCounter();
  const renderErrorCounter = createMockCounter();
  const rscRenderDuration = createMockHistogram();
  const rscStreamDuration = createMockHistogram();
  const rscManifestCounter = createMockCounter();
  const rscPageCounter = createMockCounter();
  const rscStreamCounter = createMockCounter();
  const rscActionCounter = createMockCounter();
  const rscErrorCounter = createMockCounter();
  const buildDuration = createMockHistogram();
  const bundleSizeHistogram = createMockHistogram();
  const bundleCounter = createMockCounter();
  const dependencyArtifactBuildCounter = createMockCounter();
  const dependencyArtifactBuildDuration = createMockHistogram();
  const dependencyArtifactBuildBytes = createMockHistogram();
  const dependencyArtifactBuildAssetCount = createMockHistogram();
  const dependencyArtifactBuildExternalImportCount = createMockHistogram();
  const dataFetchDuration = createMockHistogram();
  const dataFetchCounter = createMockCounter();
  const dataFetchErrorCounter = createMockCounter();
  const corsRejectionCounter = createMockCounter();
  const securityHeadersCounter = createMockCounter();
  const errorCounter = createMockCounter();
  const streamLifecycleOutcomeCounter = createMockCounter();
  const streamLifecycleDeadlineCounter = createMockCounter();
  const streamLifecycleTelemetryCounter = createMockCounter();
  const streamLifecycleRepairCounter = createMockCounter();
  const streamLifecycleShadowDivergenceCounter = createMockCounter();
  const streamLifecycleAttemptDuration = createMockHistogram();
  const streamLifecycleFirstProgressDuration = createMockHistogram();
  const streamLifecycleSemanticIdleDuration = createMockHistogram();
  const streamLifecycleToolInputDuration = createMockHistogram();
  const streamLifecycleToolExecutionDuration = createMockHistogram();

  return {
    httpRequestCounter: httpRequestCounter as never,
    httpRequestDuration: httpRequestDuration as never,
    httpActiveRequests: httpActiveRequests as never,
    cacheGetCounter: cacheGetCounter as never,
    cacheHitCounter: cacheHitCounter as never,
    cacheMissCounter: cacheMissCounter as never,
    cacheSetCounter: cacheSetCounter as never,
    cacheInvalidateCounter: cacheInvalidateCounter as never,
    cacheSizeGauge: null,
    renderDuration: renderDuration as never,
    renderCounter: renderCounter as never,
    renderErrorCounter: renderErrorCounter as never,
    rscRenderDuration: rscRenderDuration as never,
    rscStreamDuration: rscStreamDuration as never,
    rscManifestCounter: rscManifestCounter as never,
    rscPageCounter: rscPageCounter as never,
    rscStreamCounter: rscStreamCounter as never,
    rscActionCounter: rscActionCounter as never,
    rscErrorCounter: rscErrorCounter as never,
    buildDuration: buildDuration as never,
    bundleSizeHistogram: bundleSizeHistogram as never,
    bundleCounter: bundleCounter as never,
    dependencyArtifactBuildCounter: dependencyArtifactBuildCounter as never,
    dependencyArtifactBuildDuration: dependencyArtifactBuildDuration as never,
    dependencyArtifactBuildBytes: dependencyArtifactBuildBytes as never,
    dependencyArtifactBuildAssetCount: dependencyArtifactBuildAssetCount as never,
    dependencyArtifactBuildExternalImportCount: dependencyArtifactBuildExternalImportCount as never,
    dataFetchDuration: dataFetchDuration as never,
    dataFetchCounter: dataFetchCounter as never,
    dataFetchErrorCounter: dataFetchErrorCounter as never,
    corsRejectionCounter: corsRejectionCounter as never,
    securityHeadersCounter: securityHeadersCounter as never,
    errorCounter: errorCounter as never,
    memoryUsageGauge: null,
    heapUsageGauge: null,
    heapTotalGauge: null,
    heapPercentGauge: null,
    streamLifecycleOutcomeCounter: streamLifecycleOutcomeCounter as never,
    streamLifecycleDeadlineCounter: streamLifecycleDeadlineCounter as never,
    streamLifecycleTelemetryCounter: streamLifecycleTelemetryCounter as never,
    streamLifecycleRepairCounter: streamLifecycleRepairCounter as never,
    streamLifecycleShadowDivergenceCounter: streamLifecycleShadowDivergenceCounter as never,
    streamLifecycleAttemptDuration: streamLifecycleAttemptDuration as never,
    streamLifecycleFirstProgressDuration: streamLifecycleFirstProgressDuration as never,
    streamLifecycleSemanticIdleDuration: streamLifecycleSemanticIdleDuration as never,
    streamLifecycleToolInputDuration: streamLifecycleToolInputDuration as never,
    streamLifecycleToolExecutionDuration: streamLifecycleToolExecutionDuration as never,

    _httpRequestCounter: httpRequestCounter,
    _httpRequestDuration: httpRequestDuration,
    _httpActiveRequests: httpActiveRequests,
    _cacheGetCounter: cacheGetCounter,
    _cacheHitCounter: cacheHitCounter,
    _cacheMissCounter: cacheMissCounter,
    _cacheSetCounter: cacheSetCounter,
    _cacheInvalidateCounter: cacheInvalidateCounter,
    _renderDuration: renderDuration,
    _renderCounter: renderCounter,
    _renderErrorCounter: renderErrorCounter,
    _rscRenderDuration: rscRenderDuration,
    _rscStreamDuration: rscStreamDuration,
    _rscManifestCounter: rscManifestCounter,
    _rscPageCounter: rscPageCounter,
    _rscStreamCounter: rscStreamCounter,
    _rscActionCounter: rscActionCounter,
    _rscErrorCounter: rscErrorCounter,
    _buildDuration: buildDuration,
    _bundleSizeHistogram: bundleSizeHistogram,
    _bundleCounter: bundleCounter,
    _dependencyArtifactBuildCounter: dependencyArtifactBuildCounter,
    _dependencyArtifactBuildDuration: dependencyArtifactBuildDuration,
    _dependencyArtifactBuildBytes: dependencyArtifactBuildBytes,
    _dependencyArtifactBuildAssetCount: dependencyArtifactBuildAssetCount,
    _dependencyArtifactBuildExternalImportCount: dependencyArtifactBuildExternalImportCount,
    _dataFetchDuration: dataFetchDuration,
    _dataFetchCounter: dataFetchCounter,
    _dataFetchErrorCounter: dataFetchErrorCounter,
    _corsRejectionCounter: corsRejectionCounter,
    _securityHeadersCounter: securityHeadersCounter,
    _errorCounter: errorCounter,
    _streamLifecycleOutcomeCounter: streamLifecycleOutcomeCounter,
    _streamLifecycleDeadlineCounter: streamLifecycleDeadlineCounter,
    _streamLifecycleTelemetryCounter: streamLifecycleTelemetryCounter,
    _streamLifecycleRepairCounter: streamLifecycleRepairCounter,
    _streamLifecycleShadowDivergenceCounter: streamLifecycleShadowDivergenceCounter,
    _streamLifecycleAttemptDuration: streamLifecycleAttemptDuration,
    _streamLifecycleFirstProgressDuration: streamLifecycleFirstProgressDuration,
    _streamLifecycleSemanticIdleDuration: streamLifecycleSemanticIdleDuration,
    _streamLifecycleToolInputDuration: streamLifecycleToolInputDuration,
    _streamLifecycleToolExecutionDuration: streamLifecycleToolExecutionDuration,
  };
}

describe("observability/metrics/recorder", () => {
  let instruments: ReturnType<typeof createMockInstruments>;
  let runtimeState: RuntimeState;
  let recorder: MetricsRecorder;

  beforeEach(() => {
    instruments = createMockInstruments();
    runtimeState = { cacheSize: 0, activeRequests: 0 };
    recorder = new MetricsRecorder(instruments, runtimeState);
  });

  describe("instruments setter/getter", () => {
    it("should allow updating instruments after construction", () => {
      const newInstruments = createMockInstruments();
      recorder.instruments = newInstruments;
      assertEquals(recorder.instruments, newInstruments);
    });
  });

  describe("recordHttpRequest", () => {
    it("repairs poisoned state and saturates active request counters", () => {
      runtimeState.activeRequests = Number.NaN;
      recorder.recordHttpRequest();
      assertEquals(runtimeState.activeRequests, 1);

      runtimeState.activeRequests = Number.MAX_SAFE_INTEGER;
      recorder.recordHttpRequest();
      assertEquals(runtimeState.activeRequests, Number.MAX_SAFE_INTEGER);
    });

    it("updates state when attribute enumeration and getters are hostile", () => {
      const getterAttributes: Record<string, string> = {};
      Object.defineProperty(getterAttributes, "route", {
        enumerable: true,
        get() {
          throw new Error("hostile attribute getter");
        },
      });

      recorder.recordHttpRequest(getterAttributes);
      recorder.recordHttpRequest(
        new Proxy({}, {
          ownKeys() {
            throw new Error("hostile attribute enumeration");
          },
        }),
      );

      assertEquals(runtimeState.activeRequests, 2);
      assertEquals(instruments._httpRequestCounter._value, 2);
    });

    it("isolates instrument failures and still updates runtime state", () => {
      instruments.httpRequestCounter = {
        add() {
          throw new Error("telemetry counter failed");
        },
      } as never;

      recorder.recordHttpRequest();

      assertEquals(runtimeState.activeRequests, 1);
      assertEquals(instruments._httpActiveRequests._value, 1);
    });

    it("should increment http request counter and active requests", () => {
      recorder.recordHttpRequest();
      assertEquals(instruments._httpRequestCounter._value, 1);
      assertEquals(instruments._httpActiveRequests._value, 1);
      assertEquals(runtimeState.activeRequests, 1);
    });

    it("should pass attributes to counters", () => {
      const attrs = { method: "GET", path: "/api" };
      recorder.recordHttpRequest(attrs);
      assertEquals(instruments._httpRequestCounter._lastAttributes, attrs);
    });

    it("redacts sensitive and URL credential attributes", () => {
      recorder.recordHttpRequest({
        apiKey: "secret",
        endpoint: "https://example.test/path?token=secret",
      });

      assertEquals(instruments._httpRequestCounter._lastAttributes, {
        apiKey: "[REDACTED]",
        endpoint: "https://example.test/path?token=[REDACTED]",
      });
    });

    it("should accumulate multiple requests", () => {
      recorder.recordHttpRequest();
      recorder.recordHttpRequest();
      recorder.recordHttpRequest();
      assertEquals(instruments._httpRequestCounter._value, 3);
      assertEquals(runtimeState.activeRequests, 3);
    });
  });

  describe("recordHttpRequestComplete", () => {
    it("does not make active request state or gauges negative", () => {
      recorder.recordHttpRequestComplete(100);

      assertEquals(runtimeState.activeRequests, 0);
      assertEquals(instruments._httpActiveRequests._value, 0);
    });

    it("should record duration and decrement active requests", () => {
      runtimeState.activeRequests = 1;
      recorder.recordHttpRequestComplete(150);
      assertEquals(instruments._httpRequestDuration._value, 150);
      assertEquals(instruments._httpActiveRequests._value, -1);
      assertEquals(runtimeState.activeRequests, 0);
    });

    it("should pass attributes", () => {
      const attrs = { status: "200" };
      recorder.recordHttpRequestComplete(100, attrs);
      assertEquals(instruments._httpRequestDuration._lastAttributes, attrs);
    });
  });

  describe("recordCacheGet", () => {
    it("should increment get counter and hit counter on cache hit", () => {
      recorder.recordCacheGet(true);
      assertEquals(instruments._cacheGetCounter._value, 1);
      assertEquals(instruments._cacheHitCounter._value, 1);
      assertEquals(instruments._cacheMissCounter._value, 0);
    });

    it("should increment get counter and miss counter on cache miss", () => {
      recorder.recordCacheGet(false);
      assertEquals(instruments._cacheGetCounter._value, 1);
      assertEquals(instruments._cacheHitCounter._value, 0);
      assertEquals(instruments._cacheMissCounter._value, 1);
    });
  });

  describe("recordCacheSet", () => {
    it("repairs poisoned state and saturates cache size", () => {
      runtimeState.cacheSize = Number.NaN;
      recorder.recordCacheSet();
      assertEquals(runtimeState.cacheSize, 1);

      runtimeState.cacheSize = Number.MAX_SAFE_INTEGER;
      recorder.recordCacheSet();
      assertEquals(runtimeState.cacheSize, Number.MAX_SAFE_INTEGER);
    });

    it("should increment set counter and cache size", () => {
      recorder.recordCacheSet();
      assertEquals(instruments._cacheSetCounter._value, 1);
      assertEquals(runtimeState.cacheSize, 1);
    });

    it("should accumulate cache size", () => {
      recorder.recordCacheSet();
      recorder.recordCacheSet();
      recorder.recordCacheSet();
      assertEquals(runtimeState.cacheSize, 3);
    });
  });

  describe("recordCacheInvalidate", () => {
    it("ignores negative invalidation counts", () => {
      runtimeState.cacheSize = 4;

      recorder.recordCacheInvalidate(-2);

      assertEquals(runtimeState.cacheSize, 4);
      assertEquals(instruments._cacheInvalidateCounter._value, 0);
    });

    it("should increment invalidation counter and reduce cache size", () => {
      runtimeState.cacheSize = 10;
      recorder.recordCacheInvalidate(3);
      assertEquals(instruments._cacheInvalidateCounter._value, 3);
      assertEquals(runtimeState.cacheSize, 7);
    });

    it("should not let cache size go below zero", () => {
      runtimeState.cacheSize = 2;
      recorder.recordCacheInvalidate(5);
      assertEquals(runtimeState.cacheSize, 0);
    });
  });

  describe("setCacheSize", () => {
    it("normalizes negative and non-finite cache sizes", () => {
      recorder.setCacheSize(-2);
      assertEquals(runtimeState.cacheSize, 0);

      recorder.setCacheSize(Number.POSITIVE_INFINITY);
      assertEquals(runtimeState.cacheSize, 0);
    });

    it("should set cache size directly", () => {
      recorder.setCacheSize(42);
      assertEquals(runtimeState.cacheSize, 42);
    });

    it("should set cache size to zero", () => {
      runtimeState.cacheSize = 100;
      recorder.setCacheSize(0);
      assertEquals(runtimeState.cacheSize, 0);
    });
  });

  describe("recordRender", () => {
    it("never sends non-finite or unsafe durations to a metrics backend", () => {
      recorder.recordRender(Number.POSITIVE_INFINITY);
      assertEquals(instruments._renderDuration._value, 0);

      recorder.recordRender(Number.MAX_VALUE);
      assertEquals(instruments._renderDuration._value, Number.MAX_SAFE_INTEGER);
    });

    it("should record render duration and increment counter", () => {
      recorder.recordRender(200);
      assertEquals(instruments._renderDuration._value, 200);
      assertEquals(instruments._renderCounter._value, 1);
    });

    it("should pass attributes", () => {
      const attrs = { page: "/home" };
      recorder.recordRender(100, attrs);
      assertEquals(instruments._renderDuration._lastAttributes, attrs);
    });
  });

  describe("recordRenderError", () => {
    it("should increment render error counter", () => {
      recorder.recordRenderError();
      assertEquals(instruments._renderErrorCounter._value, 1);
    });

    it("should pass attributes", () => {
      const attrs = { component: "App" };
      recorder.recordRenderError(attrs);
      assertEquals(instruments._renderErrorCounter._lastAttributes, attrs);
    });
  });

  describe("recordRSCRender", () => {
    it("should record RSC render duration", () => {
      recorder.recordRSCRender(150);
      assertEquals(instruments._rscRenderDuration._value, 150);
    });
  });

  describe("recordRSCStream", () => {
    it("should record RSC stream duration", () => {
      recorder.recordRSCStream(300);
      assertEquals(instruments._rscStreamDuration._value, 300);
    });
  });

  describe("recordRSCRequest", () => {
    it("should increment manifest counter", () => {
      recorder.recordRSCRequest("manifest");
      assertEquals(instruments._rscManifestCounter._value, 1);
    });

    it("should increment page counter", () => {
      recorder.recordRSCRequest("page");
      assertEquals(instruments._rscPageCounter._value, 1);
    });

    it("should increment stream counter", () => {
      recorder.recordRSCRequest("stream");
      assertEquals(instruments._rscStreamCounter._value, 1);
    });

    it("should increment action counter", () => {
      recorder.recordRSCRequest("action");
      assertEquals(instruments._rscActionCounter._value, 1);
    });
  });

  describe("recordRSCError", () => {
    it("should increment RSC error counter", () => {
      recorder.recordRSCError();
      assertEquals(instruments._rscErrorCounter._value, 1);
    });
  });

  describe("recordBuild", () => {
    it("should record build duration", () => {
      recorder.recordBuild(5000);
      assertEquals(instruments._buildDuration._value, 5000);
    });
  });

  describe("recordBundle", () => {
    it("should record bundle size and increment counter", () => {
      recorder.recordBundle(256);
      assertEquals(instruments._bundleSizeHistogram._value, 256);
      assertEquals(instruments._bundleCounter._value, 1);
    });
  });

  describe("recordDependencyArtifactBuild", () => {
    it("should record lifecycle, output, and remaining external metrics", () => {
      recorder.recordDependencyArtifactBuild({
        event: "success",
        durationMs: 120,
        totalBytes: 2048,
        assetCount: 3,
        remainingExternalImportCount: 1,
      });

      assertEquals(instruments._dependencyArtifactBuildCounter._value, 1);
      assertEquals(
        instruments._dependencyArtifactBuildCounter._lastAttributes,
        { event: "success" },
      );
      assertEquals(instruments._dependencyArtifactBuildDuration._value, 120);
      assertEquals(instruments._dependencyArtifactBuildBytes._value, 2048);
      assertEquals(instruments._dependencyArtifactBuildAssetCount._value, 3);
      assertEquals(
        instruments._dependencyArtifactBuildExternalImportCount._value,
        1,
      );
    });

    it("should label failed builds without recording unavailable output", () => {
      recorder.recordDependencyArtifactBuild({
        event: "failure",
        durationMs: 40,
        failureCode: "dependency_artifact_graph_incomplete",
      });

      assertEquals(instruments._dependencyArtifactBuildCounter._value, 1);
      assertEquals(
        instruments._dependencyArtifactBuildCounter._lastAttributes,
        {
          event: "failure",
          failure_code: "dependency_artifact_graph_incomplete",
        },
      );
      assertEquals(instruments._dependencyArtifactBuildDuration._value, 40);
      assertEquals(instruments._dependencyArtifactBuildBytes._value, 0);
      assertEquals(instruments._dependencyArtifactBuildAssetCount._value, 0);
    });

    it("normalizes dependency artifact measurements", () => {
      recorder.recordDependencyArtifactBuild({
        event: "success",
        durationMs: Number.POSITIVE_INFINITY,
        totalBytes: Number.MAX_SAFE_INTEGER + 100,
        assetCount: 3.9,
        remainingExternalImportCount: -1,
      });

      assertEquals(instruments._dependencyArtifactBuildDuration._value, 0);
      assertEquals(
        instruments._dependencyArtifactBuildBytes._value,
        Number.MAX_SAFE_INTEGER,
      );
      assertEquals(instruments._dependencyArtifactBuildAssetCount._value, 3);
      assertEquals(
        instruments._dependencyArtifactBuildExternalImportCount._value,
        0,
      );
    });

    it("isolates dependency artifact builds from telemetry backend failures", () => {
      let attemptedWrites = 0;
      instruments._dependencyArtifactBuildCounter.add = () => {
        attemptedWrites += 1;
        throw new Error("counter unavailable");
      };
      for (
        const histogram of [
          instruments._dependencyArtifactBuildDuration,
          instruments._dependencyArtifactBuildBytes,
          instruments._dependencyArtifactBuildAssetCount,
          instruments._dependencyArtifactBuildExternalImportCount,
        ]
      ) {
        histogram.record = () => {
          attemptedWrites += 1;
          throw new Error("histogram unavailable");
        };
      }

      recorder.recordDependencyArtifactBuild({
        event: "success",
        durationMs: 120,
        totalBytes: 2048,
        assetCount: 3,
        remainingExternalImportCount: 1,
      });

      assertEquals(attemptedWrites, 5);
    });
  });

  describe("recordDataFetch", () => {
    it("should record data fetch duration and increment counter", () => {
      recorder.recordDataFetch(100);
      assertEquals(instruments._dataFetchDuration._value, 100);
      assertEquals(instruments._dataFetchCounter._value, 1);
    });
  });

  describe("recordDataFetchError", () => {
    it("should increment data fetch error counter", () => {
      recorder.recordDataFetchError();
      assertEquals(instruments._dataFetchErrorCounter._value, 1);
    });
  });

  describe("recordCorsRejection", () => {
    it("should increment CORS rejection counter", () => {
      recorder.recordCorsRejection();
      assertEquals(instruments._corsRejectionCounter._value, 1);
    });
  });

  describe("recordSecurityHeaders", () => {
    it("should increment security headers counter", () => {
      recorder.recordSecurityHeaders();
      assertEquals(instruments._securityHeadersCounter._value, 1);
    });
  });

  describe("recordError", () => {
    it("should increment the application error counter", () => {
      recorder.recordError({ type: "boom" });

      assertEquals(
        instruments._errorCounter._value,
        1,
        "recordError must increment errorCounter",
      );
      assertEquals(
        instruments._errorCounter._lastAttributes,
        { type: "boom" },
        "recordError must forward its attributes to errorCounter",
      );
      assertEquals(
        instruments._renderErrorCounter._value,
        0,
        "recordError must not write to the render error counter",
      );
    });
  });

  describe("stream lifecycle", () => {
    const attributes = { project_id: "project-123" };

    const counters = [
      ["outcome", "_streamLifecycleOutcomeCounter"],
      ["deadline", "_streamLifecycleDeadlineCounter"],
      ["telemetry", "_streamLifecycleTelemetryCounter"],
      ["repair", "_streamLifecycleRepairCounter"],
      ["shadowDivergence", "_streamLifecycleShadowDivergenceCounter"],
    ] as const;

    const durations = [
      ["attempt", "_streamLifecycleAttemptDuration"],
      ["first_progress", "_streamLifecycleFirstProgressDuration"],
      ["semantic_idle", "_streamLifecycleSemanticIdleDuration"],
      ["tool_input", "_streamLifecycleToolInputDuration"],
      ["tool_execution", "_streamLifecycleToolExecutionDuration"],
    ] as const;

    it("should route each lifecycle event to its own counter", () => {
      for (const [event, handle] of counters) {
        const scoped = createMockInstruments();
        const scopedRecorder = new MetricsRecorder(scoped, runtimeState);

        if (event === "outcome") scopedRecorder.recordStreamLifecycleOutcome(attributes);
        if (event === "deadline") scopedRecorder.recordStreamLifecycleDeadline(attributes);
        if (event === "telemetry") scopedRecorder.recordStreamLifecycleTelemetry(attributes);
        if (event === "repair") scopedRecorder.recordStreamLifecycleRepair(attributes);
        if (event === "shadowDivergence") {
          scopedRecorder.recordStreamLifecycleShadowDivergence(attributes);
        }

        assertEquals(scoped[handle]._value, 1, `${event} must increment ${handle}`);
        assertEquals(
          scoped[handle]._lastAttributes,
          attributes,
          `${event} must forward its attributes to ${handle}`,
        );
        for (const [, other] of counters) {
          if (other === handle) continue;
          assertEquals(scoped[other]._value, 0, `${event} must not increment ${other}`);
        }
      }
    });

    it("should route each duration kind to its own histogram", () => {
      for (const [kind, handle] of durations) {
        const scoped = createMockInstruments();
        const scopedRecorder = new MetricsRecorder(scoped, runtimeState);

        scopedRecorder.recordStreamLifecycleDuration(kind, 25, attributes);

        assertEquals(scoped[handle]._value, 25, `${kind} must be recorded into ${handle}`);
        assertEquals(
          scoped[handle]._lastAttributes,
          attributes,
          `${kind} must forward its attributes to ${handle}`,
        );
        for (const [, other] of durations) {
          if (other === handle) continue;
          assertEquals(scoped[other]._value, 0, `${kind} must not be recorded into ${other}`);
        }
      }
    });

    it("should clamp negative durations to zero", () => {
      recorder.recordStreamLifecycleDuration("attempt", -5, attributes);

      assertEquals(
        instruments._streamLifecycleAttemptDuration._value,
        0,
        "negative durations clamp to 0",
      );
    });
  });

  describe("null instruments", () => {
    it("should handle all null instruments gracefully", () => {
      const nullInstruments: MetricsInstruments = {
        httpRequestCounter: null,
        httpRequestDuration: null,
        httpActiveRequests: null,
        cacheGetCounter: null,
        cacheHitCounter: null,
        cacheMissCounter: null,
        cacheSetCounter: null,
        cacheInvalidateCounter: null,
        cacheSizeGauge: null,
        renderDuration: null,
        renderCounter: null,
        renderErrorCounter: null,
        rscRenderDuration: null,
        rscStreamDuration: null,
        rscManifestCounter: null,
        rscPageCounter: null,
        rscStreamCounter: null,
        rscActionCounter: null,
        rscErrorCounter: null,
        buildDuration: null,
        bundleSizeHistogram: null,
        bundleCounter: null,
        dependencyArtifactBuildCounter: null,
        dependencyArtifactBuildDuration: null,
        dependencyArtifactBuildBytes: null,
        dependencyArtifactBuildAssetCount: null,
        dependencyArtifactBuildExternalImportCount: null,
        dataFetchDuration: null,
        dataFetchCounter: null,
        dataFetchErrorCounter: null,
        corsRejectionCounter: null,
        securityHeadersCounter: null,
        errorCounter: null,
        memoryUsageGauge: null,
        heapUsageGauge: null,
        heapTotalGauge: null,
        heapPercentGauge: null,
        streamLifecycleOutcomeCounter: null,
        streamLifecycleDeadlineCounter: null,
        streamLifecycleTelemetryCounter: null,
        streamLifecycleRepairCounter: null,
        streamLifecycleShadowDivergenceCounter: null,
        streamLifecycleAttemptDuration: null,
        streamLifecycleFirstProgressDuration: null,
        streamLifecycleSemanticIdleDuration: null,
        streamLifecycleToolInputDuration: null,
        streamLifecycleToolExecutionDuration: null,
      };
      const nullRecorder = new MetricsRecorder(nullInstruments, runtimeState);

      nullRecorder.recordHttpRequest();
      nullRecorder.recordHttpRequestComplete(100);
      nullRecorder.recordCacheGet(true);
      nullRecorder.recordCacheGet(false);
      nullRecorder.recordCacheSet();
      nullRecorder.recordCacheInvalidate(5);
      nullRecorder.setCacheSize(10);
      nullRecorder.recordRender(100);
      nullRecorder.recordRenderError();
      nullRecorder.recordRSCRender(100);
      nullRecorder.recordRSCStream(100);
      nullRecorder.recordRSCRequest("manifest");
      nullRecorder.recordRSCRequest("page");
      nullRecorder.recordRSCRequest("stream");
      nullRecorder.recordRSCRequest("action");
      nullRecorder.recordRSCError();
      nullRecorder.recordBuild(100);
      nullRecorder.recordBundle(100);
      nullRecorder.recordDependencyArtifactBuild({ event: "claim" });
      nullRecorder.recordDataFetch(100);
      nullRecorder.recordDataFetchError();
      nullRecorder.recordCorsRejection();
      nullRecorder.recordSecurityHeaders();
      nullRecorder.recordError();
      nullRecorder.recordStreamLifecycleOutcome({});
      nullRecorder.recordStreamLifecycleDeadline({});
      nullRecorder.recordStreamLifecycleTelemetry({});
      nullRecorder.recordStreamLifecycleRepair({});
      nullRecorder.recordStreamLifecycleShadowDivergence({});
      nullRecorder.recordStreamLifecycleDuration("attempt", 1, {});
      nullRecorder.recordStreamLifecycleDuration("first_progress", 1, {});
      nullRecorder.recordStreamLifecycleDuration("semantic_idle", 1, {});
      nullRecorder.recordStreamLifecycleDuration("tool_input", 1, {});
      nullRecorder.recordStreamLifecycleDuration("tool_execution", 1, {});
    });
  });
});
