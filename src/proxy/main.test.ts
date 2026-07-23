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
    assertStringIncludes(source, "stripHopByHopHeaders(newHeaders)");
    assertStringIncludes(source, "stripHopByHopHeaders(responseHeaders)");
    assertStringIncludes(source, 'newHeaders.set("x-forwarded-proto"');
    assertEquals(source.match(/if \(req\.signal\.aborted\)/g)?.length, 3);
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
    const closeIndex = source.indexOf("await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(closeIndex > drainIndex, true);

    const shuttingDownIndex = source.indexOf(
      "if (shuttingDown) return createProxyDrainingResponse()",
    );
    const healthIndex = source.indexOf('if (url.pathname === "/_proxy/health")');
    assertEquals(shuttingDownIndex >= 0, true);
    assertEquals(healthIndex > shuttingDownIndex, true);
    assertStringIncludes(source, "exitCode = 1");
    assertStringIncludes(source, "exit(exitCode)");
  });

  it("starts acknowledged routing invalidation fan-out and handles signed ingress", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "startProxyRoutingInvalidationBus");
    assertStringIncludes(source, "onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup");
    assertStringIncludes(source, "handleProxyRoutingInvalidationRequest");
    assertStringIncludes(source, "if (isProduction() && !routingInvalidationBus)");
    assertStringIncludes(
      source,
      "VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer in production",
    );
    assertStringIncludes(
      source,
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

  it("fails closed on missing production credentials and production stats access", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "if (isProduction() && missingCredentials.length > 0)");
    assertStringIncludes(
      source,
      "isProduction() || Object.keys(proxyHandler.localProjects).length === 0",
    );
  });
});
