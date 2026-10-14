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
  parseProxyDrainTimeoutMs,
  ProxyRequestDrainTracker,
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
