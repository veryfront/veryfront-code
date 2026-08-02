import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe("proxy main request URL parsing", () => {
  it("parses the incoming request URL once in the router", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
    const requestUrlParses = source.match(/new URL\(req\.url\)/g) ?? [];

    assertEquals(requestUrlParses.length, 1);
  });

  it("uses bounded outbound requests with an independent body for every attempt", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "getReplayableRequestBodies(req, maxRetries)");
    assertStringIncludes(source, "body: upstreamBodies[attempt] ?? null");
    assertStringIncludes(source, "createRendererTargetUrl(baseUrl, url)");
    assertStringIncludes(source, "fetchWithProxyDeadline(serverUrl");
    assertStringIncludes(source, "waitForProxyDelay(");
    assertStringIncludes(source, "signal: req.signal");
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
    const closeIndex = source.indexOf("const closed = await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(closeIndex > drainIndex, true);
  });

  it("owns upgraded WebSocket bridges until bounded shutdown", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "createProxyWebSocketTargetUrl(");
    assertStringIncludes(source, "createProxyWebSocketBridge({");
    assertStringIncludes(source, "webSocketBridgeRegistry.track(bridge)");

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const bridgeCloseIndex = source.indexOf("() => webSocketBridgeRegistry.close()");
    const serverCloseIndex = source.indexOf("const closed = await closeProxyServerWithin");
    assertEquals(bridgeCloseIndex > drainIndex, true);
    assertEquals(serverCloseIndex > bridgeCloseIndex, true);
  });

  it("starts acknowledged routing invalidation fan-out and handles signed ingress", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "startProxyRoutingInvalidationBus");
    assertStringIncludes(source, "onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup");
    assertStringIncludes(source, "handleProxyRoutingInvalidationRequest");
    assertStringIncludes(source, "const startupConfig = readProxyStartupConfig()");
    assertStringIncludes(source, "if (startupConfig.production && !routingInvalidationBus)");
    assertStringIncludes(source, "expectedReplicas,");
    assertStringIncludes(source, "integritySecret: routingInvalidationSecret");

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const busCloseIndex = source.indexOf("() => routingInvalidationBus?.close()");
    const serverCloseIndex = source.indexOf("const closed = await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(busCloseIndex > drainIndex, true);
    assertEquals(serverCloseIndex > busCloseIndex, true);
  });
});
