import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  completeRequestTracking,
  completeRequestTrackingOnResponseEnd,
  endContentMetrics,
  endRequestLifecycle,
  startContentMetrics,
  startRequestLifecycle,
  startRequestTracking,
} from "./request-lifecycle.ts";
import { requestTracker } from "./request-tracker.ts";

describe("server/runtime-handler/request-lifecycle", () => {
  describe("startRequestLifecycle", () => {
    it("should return context with requestId", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", false);
      assertEquals(typeof ctx.requestId, "string");
      assertEquals(ctx.requestId.length > 0, true);
      ctx.stopTotal();
    });

    it("should return context with stopTotal function", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", false);
      assertEquals(typeof ctx.stopTotal, "function");
      ctx.stopTotal(); // should not throw
    });

    it("should set shouldCheckIsolation to true for non-lightweight requests", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", false);
      assertEquals(ctx.shouldCheckIsolation, true);
      ctx.stopTotal();
    });

    it("should set shouldCheckIsolation to false for lightweight requests", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", true);
      assertEquals(ctx.shouldCheckIsolation, false);
      ctx.stopTotal();
    });

    it("should use x-request-id header when available", () => {
      const req = new Request("http://localhost/test", {
        headers: { "x-request-id": "custom-id" },
      });
      const ctx = startRequestLifecycle(req, "/test", false);
      assertEquals(ctx.requestId, "custom-id");
      endRequestLifecycle(ctx);
    });
  });

  describe("endRequestLifecycle", () => {
    it("should call stopTotal and handle perfRequestId", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", false);
      // Should not throw
      endRequestLifecycle(ctx);
    });
  });

  describe("startRequestTracking / completeRequestTracking", () => {
    it("should track and complete a request", () => {
      const beforeCount = requestTracker.getInFlightCount();
      const trackingKey = startRequestTracking(
        "lifecycle-req-1",
        "slug",
        "/path",
        "GET",
        "production",
        "rel-1",
      );
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      completeRequestTracking(trackingKey, 200, false);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should handle timeout flag", () => {
      const trackingKey = startRequestTracking(
        "lifecycle-req-2",
        "slug",
        "/path",
        "GET",
        undefined,
        undefined,
      );
      completeRequestTracking(trackingKey, 504, true);
    });

    it("should keep event streams in flight until their body closes", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const source = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });

      const trackingKey = startRequestTracking(
        "lifecycle-stream-close",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response(source, {
          status: 202,
          statusText: "Streaming",
          headers: {
            "content-type": "text/event-stream",
            "server-timing": "total;dur=12.00",
            "x-stream-id": "stream-1",
          },
        }),
        false,
      );

      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      assertEquals(response.status, 202);
      assertEquals(response.statusText, "Streaming");
      assertEquals(response.headers.get("server-timing"), "total;dur=12.00");
      assertEquals(response.headers.get("x-stream-id"), "stream-1");

      const reader = response.body!.getReader();
      const firstRead = reader.read();
      controller!.enqueue(new TextEncoder().encode("data: test\n\n"));
      await firstRead;
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);

      controller!.close();
      await reader.read();
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should complete event stream tracking when the client cancels", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let sourceCancelled = false;
      const source = new ReadableStream<Uint8Array>({
        cancel() {
          sourceCancelled = true;
        },
      });

      const trackingKey = startRequestTracking(
        "lifecycle-stream-cancel",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response(source, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
        false,
      );

      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      await response.body!.cancel("client disconnected");
      assertEquals(sourceCancelled, true);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should complete tracking once when cancellation races a pending read", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      const beforeCompleted = requestTracker.getStats().completed;
      const source = new ReadableStream<Uint8Array>();

      const trackingKey = startRequestTracking(
        "lifecycle-stream-cancel-race",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response(source, { headers: { "content-type": "text/event-stream" } }),
        false,
      );

      const reader = response.body!.getReader();
      const pendingRead = reader.read();
      await reader.cancel("client disconnected");
      assertEquals((await pendingRead).done, true);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
      assertEquals(requestTracker.getStats().completed, beforeCompleted + 1);
    });

    it("should complete event stream tracking when the source errors", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const source = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });

      const trackingKey = startRequestTracking(
        "lifecycle-stream-error",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response(source, { headers: { "content-type": "text/event-stream" } }),
        false,
      );

      const read = response.body!.getReader().read();
      controller!.error(new Error("stream failed"));
      await assertRejects(() => read, Error, "stream failed");
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should complete non-streaming responses immediately", () => {
      const beforeCount = requestTracker.getInFlightCount();
      const trackingKey = startRequestTracking(
        "lifecycle-response",
        "slug",
        "/api/health",
        "GET",
        "production",
        "rel-1",
      );

      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response("ok", { status: 200 }),
        false,
      );

      assertEquals(response.status, 200);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should keep timed-out work in flight until the handler settles", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let settleHandler!: () => void;
      const handlerSettled = new Promise<void>((resolve) => {
        settleHandler = resolve;
      });
      const trackingKey = startRequestTracking(
        "lifecycle-timeout-settlement",
        "slug",
        "/api/slow",
        "POST",
        "production",
        "rel-1",
      );

      const response = completeRequestTrackingOnResponseEnd(
        trackingKey,
        new Response("Request timeout", { status: 504 }),
        true,
        null,
        handlerSettled,
      );

      assertEquals(response.status, 504);
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);

      settleHandler();
      await handlerSettled;
      await Promise.resolve();
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });
  });

  describe("startContentMetrics / endContentMetrics", () => {
    it("should not throw", () => {
      startContentMetrics();
      endContentMetrics({
        requestId: "test-id",
        pathname: "/test",
        mode: "production",
      });
    });
  });
});
