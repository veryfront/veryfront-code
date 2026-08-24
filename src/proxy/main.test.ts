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
    assertStringIncludes(source, "upstreamBodies[attempt] ?? null");

    // Teeing inside the loop would hand every retry a consumed body, so pin the
    // replay array to the scope outside the attempt loop.
    const teeIndex = source.indexOf(
      "const upstreamBodies = getReplayableRequestBodies(req, maxRetries);",
    );
    const retryLoopIndex = source.indexOf(
      "for (let attempt = 0; attempt <= maxRetries; attempt++)",
    );
    assertEquals(teeIndex >= 0, true, "the replay array must be teed from the incoming request");
    assertEquals(retryLoopIndex >= 0, true, "the upstream attempts must run in a retry loop");
    assertEquals(
      teeIndex < retryLoopIndex,
      true,
      "the replay array must be teed once before the retry loop, not per attempt",
    );
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

    // The call must carry the configured drain budget: waiting for zero would
    // close the server underneath in-flight responses.
    assertStringIncludes(
      source,
      "await proxyRequestDrainTracker.waitForDrain(SHUTDOWN_DRAIN_TIMEOUT_MS)",
      "shutdown must wait for the configured drain budget, not a zero timeout",
    );
    assertStringIncludes(
      source,
      "const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;",
      "the default drain budget must stay a real waiting window",
    );

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const closeIndex = source.indexOf("await closeProxyServerWithin");
    const handlerCloseIndex = source.indexOf('name: "proxy_handler"');
    const shutdownHooksIndex = source.indexOf('name: "extension_owners"');
    const tracingCloseIndex = source.indexOf('name: "telemetry"');
    assertEquals(drainIndex >= 0, true);
    assertEquals(closeIndex > drainIndex, true);
    assertEquals(handlerCloseIndex > closeIndex, true);
    assertEquals(shutdownHooksIndex > handlerCloseIndex, true);
    assertEquals(tracingCloseIndex > shutdownHooksIndex, true);
    assertStringIncludes(source, 'requires: ["proxy_handler"]');
  });

  it("starts acknowledged routing invalidation fan-out and handles signed ingress", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    assertStringIncludes(source, "startProxyRoutingInvalidationBus");
    assertStringIncludes(source, "onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup");
    assertStringIncludes(source, "handleProxyRoutingInvalidationRequest");
    assertStringIncludes(source, "if (isProduction() && !routingInvalidationBus)");
    // Each production guard must fail closed. Pinning the `throw` alongside the
    // message keeps a downgrade to a warning from passing as a guard.
    assertStringIncludes(
      source,
      'throw new Error("VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer in production");',
      "a missing replica count must fail startup closed in production",
    );
    assertStringIncludes(
      source,
      'throw new Error(\n    "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET must contain at least 32 bytes in production",\n  );',
      "a short integrity secret must fail startup closed in production",
    );
    assertStringIncludes(
      source,
      "if (isProduction() && !routingInvalidationBus) {\n  throw new Error(",
      "a missing invalidation bus must fail startup closed in production",
    );
    assertStringIncludes(source, "integritySecret: routingInvalidationSecret");

    const drainIndex = source.indexOf("await proxyRequestDrainTracker.waitForDrain");
    const busCloseIndex = source.indexOf('name: "routing_invalidation_bus"');
    const serverCloseIndex = source.indexOf("await closeProxyServerWithin");
    assertEquals(drainIndex >= 0, true);
    assertEquals(busCloseIndex > drainIndex, true);
    assertEquals(serverCloseIndex > busCloseIndex, true);
  });
});
