import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe("proxy main request URL parsing", () => {
  it("parses the incoming request URL once in the router", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
    const requestUrlParses = source.match(/new URL\(req\.url\)/g) ?? [];

    assertEquals(requestUrlParses.length, 1);
  });

  it("rejects an unparseable request URL with 400 instead of an escaping TypeError", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    // A malformed Host header makes Deno synthesize a req.url that new URL()
    // rejects (e.g. `http:///`). The parse must be guarded and answer 400;
    // an escaping TypeError becomes Deno's own generic 500 with no structured
    // log line and no drain tracking (veryfront-issue-inbox#828).
    const parseIndex = source.indexOf("url = new URL(req.url);");
    const guardIndex = source.lastIndexOf("try {", parseIndex);
    assertEquals(
      parseIndex >= 0,
      true,
      "the router must parse req.url into a reassignable binding",
    );
    assertEquals(
      guardIndex >= 0 && parseIndex - guardIndex < 80,
      true,
      "the request-URL parse must sit directly inside a try block",
    );
    const catchBlock = source.slice(parseIndex, source.indexOf("if (url.pathname", parseIndex));
    assertStringIncludes(
      catchBlock,
      'jsonErrorResponse(400, { error: "Bad Request" })',
      "an unparseable request URL must produce a 400 response",
    );
    // An absolute-form target with an invalid Host parses fine, so the Host
    // authority must be validated in the same guard — otherwise the
    // host-independent routes (health, stats) serve requests every other
    // route rejects.
    assertStringIncludes(
      catchBlock,
      "resolveProxyRequestHost(req, url);",
      "the Host authority must be validated before any route dispatch",
    );
    // The rejected Host value is untrusted input and must never be logged
    // verbatim (AGENTS.md, secret and internal-detail safety).
    assertStringIncludes(catchBlock, "describeRejectedHostHeader(");
  });

  it("maps a downstream ProxyRequestHostError to 400 in the router backstop", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    // An absolute-form target with an empty Host header parses as a URL but
    // fails Host validation downstream, so the guard on the parse alone would
    // only move the crash (veryfront-issue-inbox#828).
    const catchIndex = source.indexOf("proxyRequestDrainTracker.complete(requestId);");
    assertEquals(catchIndex >= 0, true);
    const routerCatch = source.slice(catchIndex, catchIndex + 700);
    assertStringIncludes(routerCatch, "error instanceof ProxyRequestHostError");
    assertStringIncludes(
      routerCatch,
      'jsonErrorResponse(400, { error: "Bad Request" })',
      "an invalid Host header must produce a 400 response, not an escaping throw",
    );
  });

  it("never logs a rejected Host header verbatim", async () => {
    const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));

    // A request only reaches the 400 warn branches because its Host failed
    // parsing or validation, so the header value is attacker-chosen (a
    // customer domain, a private hostname, or a secret pasted into the wrong
    // field). Both branches must log a bounded shape description, never the
    // untrusted value itself.
    const verbatimHostLogs = source.match(/host: req\.headers\.get\("host"\) \?\? ""/g) ?? [];
    assertEquals(
      verbatimHostLogs.length,
      0,
      "a rejected Host header must not be written verbatim into proxy logs",
    );
    const describedHostLogs =
      source.match(/host: describeRejectedHostHeader\(req\.headers\.get\("host"\)\)/g) ?? [];
    assertEquals(
      describedHostLogs.length,
      2,
      "both 400 warn branches must log the bounded Host description",
    );
    // The description itself must stay shape-only: missing/empty markers plus
    // a length, so no substring of the client's value can reach the log line.
    const helperIndex = source.indexOf("function describeRejectedHostHeader");
    assertEquals(helperIndex >= 0, true, "the bounded Host description helper must exist");
    const helper = source.slice(helperIndex, source.indexOf("\n}", helperIndex));
    assertStringIncludes(helper, '"<missing>"');
    assertStringIncludes(helper, '"<empty>"');
    assertStringIncludes(helper, "${host.length} chars");
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
