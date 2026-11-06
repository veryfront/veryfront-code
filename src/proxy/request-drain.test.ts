import { recordRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  closeProxyServerWithin,
  createProxyDrainingResponse,
  createProxyReadinessResponse,
  isLongLivedProxyRequest,
  parseProxyDrainTimeoutMs,
  PROXY_READY_PATH,
  ProxyDrainAdmission,
  ProxyRequestDrainTracker,
  withConnectionClose,
} from "./request-drain.ts";

describe("proxy request drain", () => {
  it("keeps a chunked HTML response in flight until its body is consumed", async () => {
    const tracker = new ProxyRequestDrainTracker();
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    tracker.start("preview", "GET", "/?studio_embed=true");
    const response = tracker.completeOnResponseEnd(
      "preview",
      new Request("https://preview.test/"),
      new Response(source, { headers: { "content-type": "text/html" } }),
    );
    try {
      assertEquals(tracker.getInFlightCount(), 1);
      assertEquals(await tracker.waitForDrain(10, 2), false);
      const consumed = response.text();
      sourceController!.enqueue(new TextEncoder().encode("<main>preview</main>"));
      sourceController!.close();
      assertEquals(await consumed, "<main>preview</main>");
      assertEquals(await tracker.waitForDrain(50, 2), true);
    } finally {
      if (!response.body?.locked) await response.body?.cancel("test cleanup");
    }
  });

  it("keeps a native body response in flight until transport finish without changing response identity", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const request = new Request("https://preview.test/api/provider-stream");
    const transportFinished = Promise.withResolvers<void>();
    recordRequestTransportLifetime(request, transportFinished.promise);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    tracker.start("native-stream", "GET", "/api/provider-stream");
    const response = tracker.completeOnResponseEnd("native-stream", request, source);

    assertStrictEquals(response, source);
    controller!.close();
    await Promise.resolve();
    assertEquals(tracker.getInFlightCount(), 1);

    transportFinished.resolve();
    assertEquals(await tracker.waitForDrain(50, 2), true);
  });

  it("releases native transport tracking once when completion rejects", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const request = new Request("https://preview.test/api/provider-stream");
    const transportFinished = Promise.withResolvers<void>();
    recordRequestTransportLifetime(request, transportFinished.promise);

    tracker.start("native-error", "GET", "/api/provider-stream");
    const response = tracker.completeOnResponseEnd(
      "native-error",
      request,
      new Response(new ReadableStream<Uint8Array>(), {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    assertEquals(tracker.getInFlightCount(), 1);
    transportFinished.reject(new Error("synthetic transport failure"));
    assertEquals(await tracker.waitForDrain(50, 2), true);
    await response.body!.cancel("test cleanup");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("does not complete fallback tracking on source close before terminal body consumption", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const request = new Request("https://preview.test/api/provider-stream");
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });

    tracker.start("fallback-stream", "GET", "/api/provider-stream");
    const response = tracker.completeOnResponseEnd(
      "fallback-stream",
      request,
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );

    controller!.close();
    await Promise.resolve();
    assertEquals(tracker.getInFlightCount(), 1);

    assertEquals(await response.text(), "");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("releases fallback tracking when settled native metadata leaves an aborted request", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const abort = new AbortController();
    const request = new Request("https://preview.test/api/provider-stream", {
      signal: abort.signal,
    });
    recordRequestTransportLifetime(request, Promise.resolve());
    await Promise.resolve();

    const canceled = Promise.withResolvers<unknown>();
    const source = new ReadableStream<Uint8Array>({
      cancel(reason) {
        canceled.resolve(reason);
      },
    });

    tracker.start("aborted-fallback", "GET", "/api/provider-stream");
    const reason = new DOMException("client disconnected", "AbortError");
    abort.abort(reason);
    const response = tracker.completeOnResponseEnd(
      "aborted-fallback",
      request,
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );

    assertStrictEquals(await canceled.promise, reason);
    assertEquals(await tracker.waitForDrain(50, 2), true);
    assertEquals(tracker.getInFlightCount(), 0);
    await assertRejects(() => response.text(), DOMException, "client disconnected");
  });

  it("errors an unfinished fallback body when the original request aborts during consumption", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const abort = new AbortController();
    const request = new Request("https://preview.test/api/provider-stream", {
      signal: abort.signal,
    });
    const canceled = Promise.withResolvers<unknown>();
    const source = new ReadableStream<Uint8Array>({
      cancel(reason) {
        canceled.resolve(reason);
      },
    });

    tracker.start("aborted-consuming-fallback", "GET", "/api/provider-stream");
    const response = tracker.completeOnResponseEnd(
      "aborted-consuming-fallback",
      request,
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );

    const text = response.text();
    await Promise.resolve();
    assertEquals(tracker.getInFlightCount(), 1);

    const reason = new DOMException("client disconnected", "AbortError");
    abort.abort(reason);

    await assertRejects(() => text, DOMException, "client disconnected");
    assertStrictEquals(await canceled.promise, reason);
    assertEquals(await tracker.waitForDrain(50, 2), true);
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("completes bodyless responses without changing their identity", () => {
    const tracker = new ProxyRequestDrainTracker();
    tracker.start("request-1", "GET", "/health");

    const source = new Response(null, { status: 204 });
    const response = tracker.completeOnResponseEnd(
      "request-1",
      new Request("https://preview.test/health"),
      source,
    );

    assertEquals(response === source, true);
    assertEquals(response.status, 204);
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("does not prefetch a finite HTML body before the transport consumes it", async () => {
    const tracker = new ProxyRequestDrainTracker();
    tracker.start("html", "GET", "/");
    const response = tracker.completeOnResponseEnd(
      "html",
      new Request("https://preview.test/"),
      new Response("<main>ready</main>", { headers: { "content-type": "text/html" } }),
    );
    await Promise.resolve();
    assertEquals(tracker.getInFlightCount(), 1);
    assertEquals(await response.text(), "<main>ready</main>");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("releases an HTML response when the transport cancels its body", async () => {
    const tracker = new ProxyRequestDrainTracker();
    let canceled = false;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    tracker.start("canceled-html", "GET", "/");
    const response = tracker.completeOnResponseEnd(
      "canceled-html",
      new Request("https://preview.test/"),
      new Response(source, { headers: { "content-type": "text/html" } }),
    );
    assertEquals(tracker.getInFlightCount(), 1);
    await response.body!.cancel("client disconnected");
    assertEquals(canceled, true);
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("releases a failed HTML body without making the truncated response succeed", async () => {
    const tracker = new ProxyRequestDrainTracker();
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    tracker.start("failed-html", "GET", "/");
    const response = tracker.completeOnResponseEnd(
      "failed-html",
      new Request("https://preview.test/"),
      new Response(source, { headers: { "content-type": "text/html" } }),
    );
    assertEquals(tracker.getInFlightCount(), 1);
    sourceController!.error(new Error("truncated HTML"));
    await assertRejects(() => response.text(), Error, "truncated HTML");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("keeps event streams in flight until the response body closes", async () => {
    const tracker = new ProxyRequestDrainTracker();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });

    tracker.start("request-2", "POST", "/api/control-plane/runs/test/stream");
    const response = tracker.completeOnResponseEnd(
      "request-2",
      new Request("https://preview.test/api/control-plane/runs/test/stream"),
      new Response(source, {
        status: 202,
        statusText: "Streaming",
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-stream-id": "stream-1",
        },
      }),
    );

    assertEquals(tracker.getInFlightCount(), 1);
    assertEquals(response.status, 202);
    assertEquals(response.statusText, "Streaming");
    assertEquals(response.headers.get("x-stream-id"), "stream-1");

    const reader = response.body!.getReader();
    const firstRead = reader.read();
    controller!.enqueue(new TextEncoder().encode("data: ready\n\n"));
    await firstRead;
    assertEquals(tracker.getInFlightCount(), 1);

    controller!.close();
    await reader.read();
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("waits for an active event stream to drain", async () => {
    const tracker = new ProxyRequestDrainTracker();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });

    tracker.start("request-3", "POST", "/stream");
    const response = tracker.completeOnResponseEnd(
      "request-3",
      new Request("https://preview.test/stream"),
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );
    const reader = response.body!.getReader();
    const read = reader.read();
    const drain = tracker.waitForDrain(250, 5);

    setTimeout(() => controller!.close(), 10);

    assertEquals((await read).done, true);
    assertEquals(await drain, true);
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("reports the requests that remain after the drain timeout", async () => {
    const tracker = new ProxyRequestDrainTracker();
    const source = new ReadableStream<Uint8Array>();

    tracker.start("request-4", "POST", "/stream");
    const response = tracker.completeOnResponseEnd(
      "request-4",
      new Request("https://preview.test/stream"),
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );

    assertEquals(await tracker.waitForDrain(10, 2), false);
    assertEquals(tracker.getInFlightRequests().map(({ requestId }) => requestId), ["request-4"]);

    await response.body!.cancel("test cleanup");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("rejects invalid drain timing instead of risking an unbounded loop", async () => {
    const tracker = new ProxyRequestDrainTracker();

    await assertRejects(
      () => tracker.waitForDrain(Number.NaN),
      RangeError,
      "drain timeout",
    );
    await assertRejects(
      () => tracker.waitForDrain(100, 0),
      RangeError,
      "poll interval",
    );
  });

  it("defaults only absent drain timeouts and rejects malformed policy", () => {
    assertEquals(parseProxyDrainTimeoutMs("290000", 25_000), 290_000);
    assertEquals(parseProxyDrainTimeoutMs(undefined, 25_000), 25_000);
    assertEquals(parseProxyDrainTimeoutMs("", 25_000), 25_000);
    assertThrows(
      () => parseProxyDrainTimeoutMs("invalid", 25_000),
      TypeError,
      "decimal integer",
    );
    assertThrows(
      () => parseProxyDrainTimeoutMs("-1", 25_000),
      TypeError,
      "decimal integer",
    );
    assertThrows(
      () => parseProxyDrainTimeoutMs("600001", 25_000),
      RangeError,
      "between 0 and 600000",
    );
  });

  it("returns a retryable connection-closing response while draining", () => {
    const response = createProxyDrainingResponse();

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("connection"), "close");
    assertEquals(response.headers.get("retry-after"), "1");
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("reports ready until shutdown starts, then fails readiness with the draining response", async () => {
    assertEquals(PROXY_READY_PATH, "/_proxy/ready");
    const ready = createProxyReadinessResponse(false);
    assertEquals(ready.status, 200);
    assertEquals(ready.headers.get("cache-control"), "no-store");
    assertEquals(await ready.json(), { service: "veryfront-proxy", status: "ready" });

    const draining = createProxyReadinessResponse(true);
    assertEquals(draining.status, 503);
    assertEquals(draining.headers.get("retry-after"), "1");
    await draining.body?.cancel();
  });

  it("admits requests for the grace window after SIGTERM, then refuses them", () => {
    let now = 1_000;
    const admission = new ProxyDrainAdmission(10_000, () => now);
    const plain = new Request("http://proxy.test/page");
    assertEquals(admission.admits(plain, "/page"), true);
    assertEquals(admission.getGrantedMs(), 0);

    admission.begin("SIGTERM");
    assertEquals(admission.admits(plain, "/page"), true);
    assertEquals(admission.getGrantedMs(), 10_000);

    now += 4_000;
    admission.begin("SIGTERM"); // a second signal does not extend the window
    admission.begin("SIGINT"); // nor does a later SIGINT cut it short
    assertEquals(admission.admits(plain, "/page"), true);
    assertEquals(admission.getGrantedMs(), 10_000);

    now += 6_000;
    assertEquals(admission.admits(plain, "/page"), false);
    assertThrows(() => new ProxyDrainAdmission(-1), RangeError);
  });

  it("gives SIGINT no admission grace and no grace wait", async () => {
    const admission = new ProxyDrainAdmission(60_000, () => 1_000);
    admission.begin("SIGINT");
    assertEquals(admission.getGrantedMs(), 0);
    assertEquals(admission.admits(new Request("http://proxy.test/page"), "/page"), false);

    // A 60s window would hold this wait open; SIGINT resolves it at once.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      admission.waitForWindow().then(() => "settled"),
      new Promise<string>((resolve) => {
        timeoutId = setTimeout(() => resolve("pending"), 200);
      }),
    ]);
    clearTimeout(timeoutId);
    assertEquals(settled, "settled");
  });

  it("refuses new WebSocket and SSE streams from the start of the grace window", () => {
    const admission = new ProxyDrainAdmission(10_000, () => 0);
    const runStream = new Request("http://proxy.test/api/control-plane/runs/run_1/stream", {
      method: "POST",
    });
    const eventSource = new Request("http://proxy.test/events", {
      headers: { accept: "text/event-stream" },
    });
    const webSocket = new Request("http://proxy.test/ws", {
      headers: { upgrade: "WebSocket" },
    });
    const runStatus = new Request("http://proxy.test/api/control-plane/runs/run_1");

    // Before shutdown every request is served.
    assertEquals(admission.admits(runStream, "/api/control-plane/runs/run_1/stream"), true);

    admission.begin("SIGTERM");
    assertEquals(admission.admits(runStream, "/api/control-plane/runs/run_1/stream"), false);
    assertEquals(admission.admits(eventSource, "/events"), false);
    assertEquals(admission.admits(webSocket, "/ws"), false);
    assertEquals(admission.admits(runStatus, "/api/control-plane/runs/run_1"), true);

    assertEquals(isLongLivedProxyRequest(runStream, "/api/control-plane/runs/run_1/stream"), true);
    assertEquals(
      isLongLivedProxyRequest(
        new Request("http://proxy.test/api/control-plane/runs/run_1/stream"),
        "/api/control-plane/runs/run_1/stream",
      ),
      false,
    );
  });

  it("closes connections only once shutdown has begun", async () => {
    const admission = new ProxyDrainAdmission(10_000, () => 0);
    const get = new Request("http://proxy.test/page");
    const before = admission.closeIfDraining(get, new Response("ok"));
    assertEquals(before.headers.get("connection"), null);

    admission.begin("SIGTERM");
    const during = admission.closeIfDraining(get, new Response("ok"));
    assertEquals(during.headers.get("connection"), "close");
    await before.body?.cancel();
    await during.body?.cancel();
  });

  it("closes error responses produced while draining", async () => {
    const admission = new ProxyDrainAdmission(10_000, () => 0);
    admission.begin("SIGTERM");
    const error = admission.closeIfDraining(
      new Request("http://proxy.test/page"),
      new Response("Bad Request", { status: 400 }),
    );
    assertEquals(error.status, 400);
    assertEquals(error.headers.get("connection"), "close");
    await error.body?.cancel();
  });

  it("answers a response-negotiated SSE stream admitted during the drain with the draining response", async () => {
    const admission = new ProxyDrainAdmission(10_000, () => 0);
    const sse = () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      const response = new Response(body, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
      return { response, wasCancelled: () => cancelled };
    };
    const events = new Request("http://proxy.test/api/workflows/runs/run_1/events");

    // Before shutdown an SSE response streams normally.
    const live = sse();
    assertEquals(admission.closeIfDraining(events, live.response), live.response);

    admission.begin("SIGTERM");

    // Admitted during the drain: the GET stream is retried elsewhere.
    const fresh = sse();
    const refused = admission.closeIfDraining(events, fresh.response, true);
    assertEquals(refused.status, 503);
    assertEquals(refused.headers.get("connection"), "close");
    await Promise.resolve();
    assertEquals(fresh.wasCancelled(), true);
    await refused.body?.cancel();

    // Started before the drain: keep streaming within the drain budget.
    const started = sse();
    const kept = admission.closeIfDraining(events, started.response, false);
    assertEquals(kept.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertEquals(kept.headers.get("connection"), "close");
    await kept.body?.cancel();

    // A POST already ran upstream, so it is not replayed by refusing it.
    const posted = sse();
    const post = new Request("http://proxy.test/api/chat", { method: "POST" });
    const kept2 = admission.closeIfDraining(post, posted.response, true);
    assertEquals(kept2.headers.get("content-type"), "text/event-stream; charset=utf-8");
    await kept2.body?.cancel();
  });

  it("subtracts only the granted grace from the drain budget", () => {
    const sigterm = new ProxyDrainAdmission(10_000, () => 0);
    sigterm.begin("SIGTERM");
    assertEquals(sigterm.remainingDrainBudgetMs(25_000), 15_000);
    assertEquals(sigterm.remainingDrainBudgetMs(5_000), 0);
    const sigint = new ProxyDrainAdmission(10_000, () => 0);
    sigint.begin("SIGINT");
    assertEquals(sigint.remainingDrainBudgetMs(25_000), 25_000);
  });

  it("marks admitted drain responses to close their connection", async () => {
    const mutable = withConnectionClose(new Response("ok", { headers: { "x-a": "1" } }));
    assertEquals(mutable.headers.get("connection"), "close");
    assertEquals(mutable.headers.get("x-a"), "1");

    const upstream = Response.redirect("https://example.com/next", 307);
    const rebuilt = withConnectionClose(upstream);
    assertEquals(rebuilt.status, 307);
    assertEquals(rebuilt.headers.get("location"), "https://example.com/next");
    assertEquals(rebuilt.headers.get("connection"), "close");
    await rebuilt.body?.cancel();
    await mutable.body?.cancel();
  });

  it("parses the admission grace with its own variable name", () => {
    assertEquals(
      parseProxyDrainTimeoutMs(undefined, 10_000, "SHUTDOWN_ADMISSION_GRACE_MS"),
      10_000,
    );
    assertThrows(
      () => parseProxyDrainTimeoutMs("x", 10_000, "SHUTDOWN_ADMISSION_GRACE_MS"),
      TypeError,
      "SHUTDOWN_ADMISSION_GRACE_MS",
    );
  });

  it("bounds server close when an adapter keeps waiting on open connections", async () => {
    assertEquals(await closeProxyServerWithin(() => new Promise(() => {}), 5), false);
    assertEquals(await closeProxyServerWithin(() => Promise.resolve(), 50), true);
    await assertRejects(
      () => closeProxyServerWithin(() => Promise.resolve(), Number.POSITIVE_INFINITY),
      RangeError,
      "server close timeout",
    );
  });
});
