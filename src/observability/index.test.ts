import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as localObservability from "./index.ts";
import * as observability from "veryfront/observability";

const expectedRuntimeExports = [
  "ApplicationErrorReporterInitializerName",
  "ErrorCollector",
  "FileLogSubscriber",
  "LogBuffer",
  "SpanKind",
  "SpanNames",
  "SpanStatusCode",
  "addSpanEvent",
  "createChildSpan",
  "createFileLogSubscriber",
  "createOpenTelemetryServiceTracer",
  "captureApplicationError",
  "endSpan",
  "extractContext",
  "getActiveContext",
  "getErrorCollector",
  "getGlobalMetricsAPI",
  "getLogBuffer",
  "getMetricsState",
  "getTraceContext",
  "flushApplicationErrors",
  "initAutoInstrumentation",
  "initMetrics",
  "initTracing",
  "initializeOTLP",
  "injectContext",
  "instrument",
  "instrumentBatch",
  "instrumentErrorHandler",
  "instrumentFetch",
  "instrumentHttpHandler",
  "instrumentReactRender",
  "instrumentSync",
  "interceptConsole",
  "isAutoInstrumentEnabled",
  "isMetricsEnabled",
  "isOTLPEnabled",
  "isReservedSharedRuntimeTelemetryEnvKey",
  "isTracingDegraded",
  "isTracingEnabled",
  "markRequestProfilePhase",
  "metrics",
  "parseCompileError",
  "parseMaxSize",
  "profilePhase",
  "profileSyncPhase",
  "recordApiRequest",
  "recordApiRetry",
  "recordBuild",
  "recordBundle",
  "recordCacheGet",
  "recordCacheInvalidate",
  "recordCacheSet",
  "recordContentCacheHit",
  "recordContentNetworkFetch",
  "recordCorsRejection",
  "recordDataFetch",
  "recordDataFetchError",
  "recordErrorCount",
  "recordHttpRequest",
  "recordHttpRequestComplete",
  "recordRSCError",
  "recordRSCRender",
  "recordRSCRequest",
  "recordRSCStream",
  "recordRender",
  "recordRenderError",
  "recordSecurityHeaders",
  "resetErrorCollector",
  "resetLogBuffer",
  "setActiveSpanAttributes",
  "setCacheSize",
  "setSpanAttributes",
  "shutdownMetrics",
  "shutdownOTLP",
  "shutdownTracing",
  "snapshotRequestProfiles",
  "startSpan",
  "trace",
  "withActiveSpan",
  "withSpan",
  "withSpanSync",
].sort();

describe("veryfront/observability public export surface", () => {
  it("preserves the exact runtime surface and package mapping", () => {
    assertEquals(Object.keys(localObservability).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(observability).sort(), expectedRuntimeExports);
    assertStrictEquals(observability.withSpan, localObservability.withSpan);
    assertStrictEquals(observability.metrics, localObservability.metrics);
  });

  it("does not expose test resets or mutable metrics state", () => {
    assertEquals("_resetShimForTests" in observability, false);
    assertEquals("resetMetrics" in observability, false);
    assertEquals("state" in observability, false);
    assertEquals("reset" in observability.metrics, false);
  });

  it("does not expose process-wide error-reporter mutators", () => {
    assertEquals("initializeApplicationErrorReporter" in observability, false);
    assertEquals("setApplicationErrorReporter" in observability, false);
    assertEquals("getHostTelemetryEnv" in observability, false);
  });
});
