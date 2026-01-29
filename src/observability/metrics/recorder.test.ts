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
  _dataFetchDuration: MockHistogram;
  _dataFetchCounter: MockCounter;
  _dataFetchErrorCounter: MockCounter;
  _corsRejectionCounter: MockCounter;
  _securityHeadersCounter: MockCounter;
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
  const dataFetchDuration = createMockHistogram();
  const dataFetchCounter = createMockCounter();
  const dataFetchErrorCounter = createMockCounter();
  const corsRejectionCounter = createMockCounter();
  const securityHeadersCounter = createMockCounter();

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
    dataFetchDuration: dataFetchDuration as never,
    dataFetchCounter: dataFetchCounter as never,
    dataFetchErrorCounter: dataFetchErrorCounter as never,
    corsRejectionCounter: corsRejectionCounter as never,
    securityHeadersCounter: securityHeadersCounter as never,
    memoryUsageGauge: null,
    heapUsageGauge: null,
    heapTotalGauge: null,
    heapPercentGauge: null,
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
    _dataFetchDuration: dataFetchDuration,
    _dataFetchCounter: dataFetchCounter,
    _dataFetchErrorCounter: dataFetchErrorCounter,
    _corsRejectionCounter: corsRejectionCounter,
    _securityHeadersCounter: securityHeadersCounter,
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

    it("should accumulate multiple requests", () => {
      recorder.recordHttpRequest();
      recorder.recordHttpRequest();
      recorder.recordHttpRequest();
      assertEquals(instruments._httpRequestCounter._value, 3);
      assertEquals(runtimeState.activeRequests, 3);
    });
  });

  describe("recordHttpRequestComplete", () => {
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
        dataFetchDuration: null,
        dataFetchCounter: null,
        dataFetchErrorCounter: null,
        corsRejectionCounter: null,
        securityHeadersCounter: null,
        memoryUsageGauge: null,
        heapUsageGauge: null,
        heapTotalGauge: null,
        heapPercentGauge: null,
      };
      const nullRecorder = new MetricsRecorder(nullInstruments, runtimeState);

      // All of these should not throw
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
      nullRecorder.recordDataFetch(100);
      nullRecorder.recordDataFetchError();
      nullRecorder.recordCorsRejection();
      nullRecorder.recordSecurityHeaders();
    });
  });
});
