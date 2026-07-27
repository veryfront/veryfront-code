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
});
