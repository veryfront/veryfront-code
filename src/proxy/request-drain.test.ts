import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  closeProxyServerWithin,
  createProxyDrainingResponse,
  parseProxyDrainTimeoutMs,
  ProxyRequestDrainTracker,
} from "./request-drain.ts";

describe("proxy request drain", () => {
  it("completes non-streaming responses when headers are ready", () => {
    const tracker = new ProxyRequestDrainTracker();
    tracker.start("request-1", "GET", "/health");

    const response = tracker.completeOnResponseEnd(
      "request-1",
      new Response("ok", { status: 200 }),
    );

    assertEquals(response.status, 200);
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
      new Response(source, { headers: { "content-type": "text/event-stream" } }),
    );

    assertEquals(await tracker.waitForDrain(10, 2), false);
    assertEquals(tracker.getInFlightRequests().map(({ requestId }) => requestId), ["request-4"]);

    await response.body!.cancel("test cleanup");
    assertEquals(tracker.getInFlightCount(), 0);
  });

  it("uses a safe default for invalid drain timeout values", () => {
    assertEquals(parseProxyDrainTimeoutMs("290000", 25_000), 290_000);
    assertEquals(parseProxyDrainTimeoutMs("invalid", 25_000), 25_000);
    assertEquals(parseProxyDrainTimeoutMs("-1", 25_000), 25_000);
  });

  it("returns a retryable connection-closing response while draining", () => {
    const response = createProxyDrainingResponse();

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("connection"), "close");
    assertEquals(response.headers.get("retry-after"), "1");
  });

  it("bounds server close when an adapter keeps waiting on open connections", async () => {
    assertEquals(await closeProxyServerWithin(() => new Promise(() => {}), 5), false);
    assertEquals(await closeProxyServerWithin(() => Promise.resolve(), 50), true);
  });
});
