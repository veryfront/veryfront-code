import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { requestTracker } from "./request-tracker.ts";

describe("server/runtime-handler/request-tracker", () => {
  afterEach(() => {
    // Clean up any tracked requests
    for (const tracked of requestTracker.getInFlightRequests()) {
      requestTracker.complete(tracked.requestId, 200);
    }
  });

  describe("start / complete", () => {
    it("should track a started request", () => {
      requestTracker.start("req-1", "my-project", "/page", "GET");
      assertEquals(requestTracker.getInFlightCount(), 1);
      requestTracker.complete("req-1", 200);
    });

    it("should remove request on complete", () => {
      requestTracker.start("req-2", "my-project", "/page", "GET");
      requestTracker.complete("req-2", 200);
      assertEquals(requestTracker.getInFlightCount(), 0);
    });

    it("should handle completing an unknown request gracefully", () => {
      requestTracker.complete("nonexistent", 200);
      assertEquals(requestTracker.getInFlightCount(), 0);
    });

    it("should track multiple requests simultaneously", () => {
      const startCount = requestTracker.getInFlightCount();
      requestTracker.start("req-a", "proj", "/a", "GET");
      requestTracker.start("req-b", "proj", "/b", "POST");
      requestTracker.start("req-c", "proj", "/c", "GET");
      assertEquals(requestTracker.getInFlightCount(), startCount + 3);
      requestTracker.complete("req-a", 200);
      requestTracker.complete("req-b", 201);
      requestTracker.complete("req-c", 404);
      assertEquals(requestTracker.getInFlightCount(), startCount);
    });
  });

  describe("getInFlightRequests", () => {
    it("should return tracked request details", () => {
      requestTracker.start("req-detail", "slug-1", "/test", "POST");
      const requests = requestTracker.getInFlightRequests();
      const found = requests.find((r) => r.requestId === "req-detail");
      assertEquals(found?.projectSlug, "slug-1");
      assertEquals(found?.path, "/test");
      assertEquals(found?.method, "POST");
      requestTracker.complete("req-detail", 200);
    });
  });

  describe("getStats", () => {
    it("should return stats with in-flight, total, completed, timedOut counts", () => {
      const stats = requestTracker.getStats();
      assertEquals(typeof stats.inFlight, "number");
      assertEquals(typeof stats.total, "number");
      assertEquals(typeof stats.completed, "number");
      assertEquals(typeof stats.timedOut, "number");
    });

    it("should increment total on start", () => {
      const before = requestTracker.getStats().total;
      requestTracker.start("req-stats", "proj", "/s", "GET");
      const after = requestTracker.getStats().total;
      assertEquals(after, before + 1);
      requestTracker.complete("req-stats", 200);
    });

    it("should increment completed on normal complete", () => {
      const before = requestTracker.getStats().completed;
      requestTracker.start("req-comp", "proj", "/c", "GET");
      requestTracker.complete("req-comp", 200, false);
      const after = requestTracker.getStats().completed;
      assertEquals(after, before + 1);
    });

    it("should increment timedOut when complete with timedOut flag", () => {
      const before = requestTracker.getStats().timedOut;
      requestTracker.start("req-timeout", "proj", "/t", "GET");
      requestTracker.complete("req-timeout", 504, true);
      const after = requestTracker.getStats().timedOut;
      assertEquals(after, before + 1);
    });
  });

  describe("waitForDrain", () => {
    it("should return true immediately when no in-flight requests", async () => {
      const result = await requestTracker.waitForDrain(100, 10);
      assertEquals(result, true);
    });

    it("should return true when requests complete within timeout", async () => {
      requestTracker.start("req-drain", "proj", "/d", "GET");
      // Complete after a tiny delay
      setTimeout(() => requestTracker.complete("req-drain", 200), 10);
      const result = await requestTracker.waitForDrain(500, 5);
      assertEquals(result, true);
    });

    it("should return false when drain times out", async () => {
      requestTracker.start("req-stuck", "proj", "/stuck", "GET");
      const result = await requestTracker.waitForDrain(50, 10);
      assertEquals(result, false);
      requestTracker.complete("req-stuck", 200);
    });
  });

  describe("module request logging", () => {
    it("should handle module request path completion without error", () => {
      requestTracker.start("req-mod", "proj", "/_vf_modules/foo.js", "GET");
      requestTracker.complete("req-mod", 200);
    });

    it("should handle _veryfront module path completion without error", () => {
      requestTracker.start("req-vf", "proj", "/_veryfront/bar.js", "GET");
      requestTracker.complete("req-vf", 200);
    });
  });

  describe("WebSocket path handling", () => {
    it("should not set slow timer for WebSocket path", () => {
      requestTracker.start("req-ws", "proj", "/_ws", "GET");
      // Just verify it doesn't crash and tracks correctly
      assertEquals(requestTracker.getInFlightCount() >= 1, true);
      requestTracker.complete("req-ws", 101);
    });
  });

  describe("env and releaseId tracking", () => {
    it("should accept optional env and releaseId", () => {
      requestTracker.start("req-env", "proj", "/path", "GET", "production", "rel-123");
      const requests = requestTracker.getInFlightRequests();
      const found = requests.find((r) => r.requestId === "req-env");
      assertEquals(found?.env, "production");
      assertEquals(found?.releaseId, "rel-123");
      requestTracker.complete("req-env", 200);
    });
  });

  describe("getStats accumulation", () => {
    it("tracks total and completed independently", () => {
      const before = requestTracker.getStats();
      requestTracker.start("acc-1", "proj", "/a", "GET");
      requestTracker.start("acc-2", "proj", "/b", "POST");
      requestTracker.complete("acc-1", 200);
      const after = requestTracker.getStats();
      assertEquals(after.total, before.total + 2);
      assertEquals(after.completed, before.completed + 1);
      assertEquals(after.inFlight, before.inFlight + 1);
      requestTracker.complete("acc-2", 200);
    });
  });

  describe("getInFlightRequests fields", () => {
    it("returns requests with all expected fields", () => {
      requestTracker.start("field-1", "slug-x", "/test", "PUT", "staging", "rel-456");
      const requests = requestTracker.getInFlightRequests();
      const found = requests.find((r) => r.requestId === "field-1");
      assertEquals(found?.projectSlug, "slug-x");
      assertEquals(found?.path, "/test");
      assertEquals(found?.method, "PUT");
      assertEquals(found?.env, "staging");
      assertEquals(found?.releaseId, "rel-456");
      assertEquals(typeof found?.startTime, "number");
      requestTracker.complete("field-1", 200);
    });
  });

  describe("complete logging behavior", () => {
    it("handles module request with short duration (no debug log)", () => {
      requestTracker.start("fast-mod", "proj", "/_vf_modules/fast.js", "GET");
      requestTracker.complete("fast-mod", 200);
      // Just verify no error
    });

    it("handles regular request completion with logging", () => {
      requestTracker.start("reg-req", "proj", "/about", "GET");
      requestTracker.complete("reg-req", 200);
      // Just verify no error
    });

    it("handles 404 status completion", () => {
      requestTracker.start("not-found", "proj", "/missing", "GET");
      requestTracker.complete("not-found", 404);
    });

    it("handles 500 status completion", () => {
      requestTracker.start("error-req", "proj", "/broken", "GET");
      requestTracker.complete("error-req", 500);
    });
  });

  describe("waitForDrain edge cases", () => {
    it("completes drain when request finished during polling", async () => {
      requestTracker.start("drain-fast", "proj", "/d", "GET");
      setTimeout(() => requestTracker.complete("drain-fast", 200), 5);
      const result = await requestTracker.waitForDrain(1000, 5);
      assertEquals(result, true);
    });
  });

  describe("timer cleanup", () => {
    it("should clear both slow and very slow timers on completion", () => {
      const clearedTimers: ReturnType<typeof setTimeout>[] = [];
      const originalClearTimeout = globalThis.clearTimeout;
      globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
        if (id !== undefined) clearedTimers.push(id);
        originalClearTimeout(id);
      }) as typeof clearTimeout;

      try {
        requestTracker.start("req-timer", "proj", "/slow", "GET");
        requestTracker.complete("req-timer", 200);

        // Should have cleared the slow timer (verySlowTimer hasn't been set
        // yet since the outer timer hasn't fired)
        assertEquals(clearedTimers.length >= 1, true);
      } finally {
        globalThis.clearTimeout = originalClearTimeout;
      }
    });
  });
});
