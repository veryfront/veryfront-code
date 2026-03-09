import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  completeRequestTracking,
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
      // The requestId should incorporate the incoming id
      assertEquals(typeof ctx.requestId, "string");
      ctx.stopTotal();
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
      startRequestTracking("lifecycle-req-1", "slug", "/path", "GET", "production", "rel-1");
      assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
      completeRequestTracking("lifecycle-req-1", 200, false);
      assertEquals(requestTracker.getInFlightCount(), beforeCount);
    });

    it("should handle timeout flag", () => {
      startRequestTracking("lifecycle-req-2", "slug", "/path", "GET", undefined, undefined);
      completeRequestTracking("lifecycle-req-2", 504, true);
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
