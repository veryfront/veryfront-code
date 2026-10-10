import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
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
import { gracefullyShutdownProductionServerWithDependencies } from "../graceful-shutdown.ts";

describe("server/runtime-handler/request-lifecycle", () => {
  afterEach(() => {
    for (const tracked of requestTracker.getInFlightRequests()) {
      requestTracker.complete(tracked.requestId, 200);
    }
    requestTracker.shutdown();
  });

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
      assertEquals(
        ctx.requestId,
        "custom-id",
        "an incoming x-request-id must be carried into the request id",
      );
      ctx.stopTotal();
    });

    it("should mint a fresh id when no x-request-id header is present", () => {
      const req = new Request("http://localhost/test");
      const ctx = startRequestLifecycle(req, "/test", false);
      assertEquals(
        ctx.requestId !== "custom-id",
        true,
        "a missing header must not reuse a previous request id",
      );
      assertEquals(
        /^[0-9a-f]{8}-[0-9a-f]{4}-/u.test(ctx.requestId),
        true,
        "a missing x-request-id header must mint a fresh UUID",
      );
      ctx.stopTotal();
    });
  });

  describe("endRequestLifecycle", () => {
    it("should call stopTotal exactly once", () => {
      let stops = 0;
      const ctx = {
        requestId: "lifecycle-end",
        perfRequestId: undefined,
        stopTotal: () => {
          stops++;
        },
        shouldCheckIsolation: true,
      };
      endRequestLifecycle(ctx);
      assertEquals(stops, 1, "endRequestLifecycle must stop the total request timer exactly once");
    });

    it("should call stopTotal and handle perfRequestId", () => {
      let stops = 0;
      const ctx = {
        requestId: "lifecycle-end-perf",
        perfRequestId: "perf-1",
        stopTotal: () => {
          stops++;
        },
        shouldCheckIsolation: true,
      };
      endRequestLifecycle(ctx);
      assertEquals(
        stops,
        1,
        "endRequestLifecycle must stop the total request timer when a perf id is present",
      );
    });
  });

  describe("startRequestTracking / completeRequestTracking", () => {
    it("should track and complete a request", () => {
      const beforeCount = requestTracker.getInFlightCount();
      startRequestTracking("lifecycle-req-1", "slug", "/path", "GET", "production", "rel-1");
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      completeRequestTracking("lifecycle-req-1", 200, false);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should handle timeout flag", () => {
      startRequestTracking("lifecycle-req-2", "slug", "/path", "GET", undefined, undefined);
      completeRequestTracking("lifecycle-req-2", 504, true);
    });

    it("should keep event streams in flight until their body closes", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const source = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });

      startRequestTracking(
        "lifecycle-stream-close",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-stream-close",
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

      startRequestTracking(
        "lifecycle-stream-cancel",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-stream-cancel",
        new Response(source, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
        false,
      );

      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      await response.body!.cancel("client disconnected");
      assertEquals(sourceCancelled, true);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("keeps opted-in non-SSE hosted bodies in the shutdown drain", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let release: (() => void) | undefined;
      startRequestTracking(
        "lifecycle-hosted-stream",
        "slug",
        "/api/stream",
        "GET",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-hosted-stream",
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("prefix"));
              release = () => controller.close();
            },
          }, { highWaterMark: 0 }),
        ),
        false,
        undefined,
        undefined,
        true,
      );
      const reader = response.body!.getReader();
      await reader.read();
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      release!();
      // Closing the source must not finish tracking while the transport still
      // has not requested its terminal read.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      assertEquals((await reader.read()).done, true);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should complete tracking once when cancellation races a pending read", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      const beforeCompleted = requestTracker.getStats().completed;
      const source = new ReadableStream<Uint8Array>();

      startRequestTracking(
        "lifecycle-stream-cancel-race",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-stream-cancel-race",
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

      startRequestTracking(
        "lifecycle-stream-error",
        "slug",
        "/api/control-plane/runs/test/stream",
        "POST",
        "production",
        "rel-1",
      );
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-stream-error",
        new Response(source, { headers: { "content-type": "text/event-stream" } }),
        false,
      );

      const read = response.body!.getReader().read();
      controller!.error(new Error("stream failed"));
      await assertRejects(() => read, Error, "stream failed");
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    for (const outcome of ["close", "cancel", "error"] as const) {
      it(`drains delayed HTML on ${outcome} before aborting the server`, async () => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const source = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            value.enqueue(new TextEncoder().encode("<html>"));
          },
        });
        startRequestTracking("lifecycle-html-shutdown", "slug", "/", "GET", "preview", "rel-1");
        const response = completeRequestTrackingOnResponseEnd(
          "lifecycle-html-shutdown",
          new Response(source, { headers: { "content-type": "text/html", "x-release": "rel-1" } }),
          false,
        );
        const reader = response.body!.getReader();
        const events: string[] = [];
        let startedDrain!: () => void;
        const drainStarted = new Promise<void>((resolve) => startedDrain = resolve);
        const shutdown = gracefullyShutdownProductionServerWithDependencies({
          signal: "SIGTERM",
          drainTimeoutMs: 1000,
          abort: () => {
            events.push("abort");
          },
          stop: () => {
            events.push("stop");
            return Promise.resolve();
          },
          logger: { info: () => {}, warn: () => {} },
        }, {
          markServerShuttingDown: () => {},
          setServerInitialized: () => {},
          requestTracker: {
            getInFlightCount: () => requestTracker.getInFlightCount(),
            waitForDrain: (timeout) => {
              startedDrain();
              return requestTracker.waitForDrain(timeout, 1);
            },
            shutdown: () => requestTracker.shutdown(),
          },
          shutdownTelemetry: () => Promise.resolve(),
        });
        try {
          await drainStarted;
          assertEquals(requestTracker.getInFlightCount(), 1);
          assertEquals(events, []);
          assertEquals(response.headers.get("x-release"), "rel-1");
          assertEquals(new TextDecoder().decode((await reader.read()).value), "<html>");
          assertEquals(events, []);
          if (outcome === "close") {
            controller.enqueue(new TextEncoder().encode("done</html>"));
            controller.close();
            assertEquals(new TextDecoder().decode((await reader.read()).value), "done</html>");
            assertEquals((await reader.read()).done, true);
          } else if (outcome === "cancel") {
            await reader.cancel("client disconnected");
          } else {
            const pendingRead = reader.read();
            controller.error(new Error("HTML failed"));
            await assertRejects(() => pendingRead, Error, "HTML failed");
          }
          assertEquals(await shutdown, true);
          assertEquals(events, ["abort", "stop"]);
        } finally {
          await reader.cancel().catch(() => {});
          await shutdown;
        }
      });
    }

    for (const settleResponseBody of [false, true]) {
      it(`keeps ordinary response bodies tracked until terminal consumption (explicit=${settleResponseBody})`, async () => {
        startRequestTracking("lifecycle-final-chunk", "slug", "/", "GET", "preview", "rel-1");
        const response = completeRequestTrackingOnResponseEnd(
          "lifecycle-final-chunk",
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("final HTML"));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/html" } },
          ),
          false,
          undefined,
          undefined,
          settleResponseBody,
        );
        const reader = response.body!.getReader();
        try {
          assertEquals(new TextDecoder().decode((await reader.read()).value), "final HTML");
          await Promise.resolve();
          assertEquals(requestTracker.getInFlightCount(), 1);
          assertEquals((await reader.read()).done, true);
          assertEquals(requestTracker.getInFlightCount(), 0);
        } finally {
          await reader.cancel().catch(() => {});
        }
      });
    }

    it("keeps ordinary response bodies tracked until consumed", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      startRequestTracking(
        "lifecycle-response",
        "slug",
        "/api/health",
        "GET",
        "production",
        "rel-1",
      );

      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-response",
        new Response("ok", { status: 200 }),
        false,
      );

      assertEquals(response.status, 200);
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      assertEquals(await response.text(), "ok");
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should complete bodyless responses immediately", () => {
      const response = new Response(null, { status: 204 });
      startRequestTracking("lifecycle-bodyless", "slug", "/", "GET", "preview", "rel-1");
      assertEquals(
        completeRequestTrackingOnResponseEnd("lifecycle-bodyless", response, false),
        response,
      );
      assertEquals(requestTracker.getInFlightCount(), 0);
    });

    it("still forces bounded shutdown when an ordinary body does not settle", async () => {
      startRequestTracking("lifecycle-html-drain-timeout", "slug", "/", "GET", "preview", "rel-1");
      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-html-drain-timeout",
        new Response(new ReadableStream(), { headers: { "content-type": "text/html" } }),
        false,
      );
      const events: string[] = [];
      const drained = await gracefullyShutdownProductionServerWithDependencies({
        signal: "SIGTERM",
        drainTimeoutMs: 0,
        abort: () => {
          events.push("abort");
        },
        stop: () => {
          events.push("stop");
          return Promise.resolve();
        },
        logger: { info: () => {}, warn: () => {} },
      }, {
        markServerShuttingDown: () => {},
        setServerInitialized: () => {},
        requestTracker,
        shutdownTelemetry: () => Promise.resolve(),
      });
      assertEquals(drained, false);
      assertEquals(events, ["abort", "stop"]);
      await response.body!.cancel();
    });

    it("should keep timed-out work in flight until the handler settles", async () => {
      const beforeCount = requestTracker.getInFlightCount();
      let settleHandler!: () => void;
      const handlerSettled = new Promise<void>((resolve) => {
        settleHandler = resolve;
      });
      startRequestTracking(
        "lifecycle-timeout-settlement",
        "slug",
        "/api/slow",
        "POST",
        "production",
        "rel-1",
      );

      const response = completeRequestTrackingOnResponseEnd(
        "lifecycle-timeout-settlement",
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
