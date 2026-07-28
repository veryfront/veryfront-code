import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe("proxy main request URL parsing", () => {
  it("parses the incoming request URL once in the router", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
    const requestUrlParses = source.match(/new URL\(req\.url\)/g) ?? [];

    assertEquals(requestUrlParses.length, 1);
  });

  it("uses an independent request body for every upstream attempt", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "getReplayableRequestBodies(req, maxRetries)");
    assertStringIncludes(source, "body: upstreamBodies[attempt] ?? null");
  });

  it("bounds and cancels outbound work without exposing query strings to spans", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "createRendererTargetUrl(baseUrl, url)");
    assertStringIncludes(source, "createApiTargetUrl(config.apiBaseUrl, url)");
    assertStringIncludes(source, "waitForProxyDelay(VERYFRONT_SERVER_RETRY_DELAY_MS, req.signal)");
    assertStringIncludes(source, "fetchWithProxyDeadline(serverUrl");
    assertStringIncludes(source, "fetchWithProxyDeadline(apiUrl");
    assertStringIncludes(source, 'redirect: "manual"');
    assertStringIncludes(source, "sanitizeUrlForSpan(serverUrl.toString())");
    assertStringIncludes(source, "sanitizeUrlForSpan(apiUrl.toString())");
    assertEquals(source.includes('url.pathname.replace(/^\\/\\/+/, "/")'), false);
  });

  it("reports draining health and prevents API response caching", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "jsonErrorResponse(shuttingDown ? 503 : 200");
    assertStringIncludes(source, 'status: shuttingDown ? "draining" : "ok"');
    assertStringIncludes(source, '"Cache-Control": "no-store"');
    assertStringIncludes(source, '"X-Content-Type-Options": "nosniff"');
  });

  it("drains tracked responses before closing the proxy server", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "if (shuttingDown) return createProxyDrainingResponse()");
    assertStringIncludes(
      source,
      "proxyRequestDrainTracker.start(requestId, req.method, url.pathname)",
    );
    assertStringIncludes(
      source,
      "proxyRequestDrainTracker.completeOnResponseEnd(requestId, response)",
    );

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const webSocketCloseIndex = source.indexOf(
      "run: () => proxyWebSocketBridgeRegistry.close()",
    );
    const closeIndex = source.indexOf("await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(webSocketCloseIndex > drainIndex, true);
    assertEquals(closeIndex > webSocketCloseIndex, true);
    assertStringIncludes(
      source,
      "proxyWebSocketBridgeRegistry.track(bridge)",
    );
    assertStringIncludes(
      source,
      "startupConfig.maxActiveWebSocketBridges",
    );
    assertStringIncludes(
      source,
      "createProxyContextHeaders(req.headers, ctx)",
    );
  });

  it("starts acknowledged routing invalidation fan-out and handles signed ingress", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
    const startupConfigSource = await Deno.readTextFile(
      new URL("./startup-config.ts", import.meta.url),
    );

    assertStringIncludes(source, "startProxyRoutingInvalidationBus");
    assertStringIncludes(source, "readProxyStartupConfig");
    assertStringIncludes(source, "onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup");
    assertStringIncludes(source, "handleProxyRoutingInvalidationRequest");
    assertStringIncludes(source, "if (startupConfig.production && !routingInvalidationBus)");
    assertStringIncludes(
      startupConfigSource,
      "VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer in production",
    );
    assertStringIncludes(
      startupConfigSource,
      "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET must contain at least 32 bytes in production",
    );
    assertStringIncludes(source, "integritySecret: routingInvalidationSecret");

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const busCloseIndex = source.indexOf("await routingInvalidationBus?.close()");
    const serverCloseIndex = source.indexOf("await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(busCloseIndex > drainIndex, true);
    assertEquals(serverCloseIndex > busCloseIndex, true);
  });

  it("uses bounded behavioral cleanup and exits nonzero when a step fails", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "runProxyShutdownSteps");
    assertStringIncludes(source, "SHUTDOWN_CLEANUP_TIMEOUT_MS");
    assertStringIncludes(source, "exit(shutdownFailed ? 1 : 0)");
    assertEquals(source.includes("finally {\n    exit(0)"), false);
  });

  it("owns signals before cancellable startup and removes them last during shutdown", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "createProxyStartupSignalRouter");
    assertStringIncludes(source, "acquireProxySignalHandlers({");
    assertStringIncludes(source, "startupRollback,");
    assertStringIncludes(source, "registerSignal: onSignal");
    assertStringIncludes(source, "handleShutdownFailure: async (error)");
    assertStringIncludes(source, 'proxyLogger.error("Unhandled shutdown error"');
    assertStringIncludes(source, "await flushApplicationErrors()");
    assertStringIncludes(
      source,
      "startupSignalRouter.commit(() => startupRollback.commit())",
    );
    assertEquals(source.includes("prepareForRuntime:"), false);

    const signalAcquireIndex = source.indexOf(
      "acquireProxySignalHandlers({",
    );
    const sentryInitializationIndex = source.indexOf(
      'initializeSentryFromEnv("veryfront-proxy")',
    );
    const sentryShutdownOwnerIndex = source.indexOf(
      'startupRollback.own("sentry", shutdownSentry)',
    );
    const applicationErrorsOwnerIndex = source.indexOf(
      'startupRollback.own("application-errors"',
    );
    const rendererAcquisitionIndex = source.indexOf("const rendererRouter = await");
    const authAcquisitionIndex = source.indexOf("const authProvider = await");
    const cacheAcquisitionIndex = source.indexOf("const startupCache = await");
    const busAcquisitionIndex = source.indexOf("const routingInvalidationBus = await");
    const rendererReadyIndex = source.indexOf("rendererRouter?.ready()");
    assertEquals(signalAcquireIndex >= 0, true);
    assertEquals(sentryShutdownOwnerIndex > signalAcquireIndex, true);
    assertEquals(applicationErrorsOwnerIndex > sentryShutdownOwnerIndex, true);
    assertEquals(sentryInitializationIndex > applicationErrorsOwnerIndex, true);
    for (
      const stageIndex of [
        sentryInitializationIndex,
        rendererAcquisitionIndex,
        authAcquisitionIndex,
        cacheAcquisitionIndex,
        busAcquisitionIndex,
      ]
    ) {
      assertEquals(stageIndex > signalAcquireIndex, true);
    }
    assertEquals(rendererReadyIndex > signalAcquireIndex, true);

    const cleanupStart = source.indexOf(
      "const cleanupFailures = await runProxyShutdownSteps([",
    );
    const cleanupEnd = source.indexOf(
      "], SHUTDOWN_CLEANUP_TIMEOUT_MS);",
      cleanupStart,
    );
    const cleanupPlan = source.slice(cleanupStart, cleanupEnd);
    assertEquals(cleanupStart >= 0, true);
    assertEquals(cleanupEnd > cleanupStart, true);
    assertEquals(
      cleanupPlan.lastIndexOf('name: "signal-handlers"'),
      cleanupPlan.lastIndexOf("name:"),
    );
    const proxyHandlerCleanupIndex = cleanupPlan.indexOf('name: "proxy-handler"');
    const tokenCacheCleanupIndex = cleanupPlan.indexOf('name: "token-cache"');
    const telemetryCleanupIndex = cleanupPlan.indexOf('name: "telemetry"');
    assertEquals(proxyHandlerCleanupIndex >= 0, true);
    assertEquals(tokenCacheCleanupIndex > proxyHandlerCleanupIndex, true);
    assertEquals(telemetryCleanupIndex > tokenCacheCleanupIndex, true);
    assertStringIncludes(cleanupPlan, "run: () => cache.close()");
    assertStringIncludes(cleanupPlan, "run: () => signalHandlers?.dispose()");
  });

  it("rolls back partially acquired startup resources without duplicate ownership", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "createProxyStartupRollback");
    for (
      const resourceName of [
        "renderer-router",
        "server-resolver",
        "websocket-bridges",
        "auth-provider-registration",
        "proxy-handler",
        "routing-invalidation-bus",
        "http-server",
      ]
    ) {
      assertStringIncludes(
        source,
        `await acquireProxyStartupResource(\n  "${resourceName}"`,
      );
    }
    assertStringIncludes(source, 'startupRollback.own("telemetry"');
    assertStringIncludes(source, "acquireProxyStartupCache(");
    assertStringIncludes(source, "startupSignalRouter.startupSignal");
    assertStringIncludes(
      source,
      "await handler.close();\n    startupCache.transferToHandler();",
    );
    assertEquals(
      source.match(/startupCache\.transferToHandler\(\)/g)?.length,
      1,
    );
    assertStringIncludes(source, "startProxyListener");
    assertStringIncludes(source, "await listener.finished");
    assertStringIncludes(source, "createProxyShutdownCoordinator");
    assertStringIncludes(
      source,
      "shutdownCoordinator = await runProxyStartupStage(() =>",
    );
    assertStringIncludes(
      source,
      "const listener = await runProxyStartupStage(() =>",
    );
    assertStringIncludes(source, "Proxy startup rollback step failed");
    assertStringIncludes(source, "Proxy startup rollback step timed out");
  });
});
