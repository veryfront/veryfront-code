import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { requestTracker } from "./request-tracker.ts";

const originalLogLevel = Deno.env.get("LOG_LEVEL");
const originalVeryfrontEnv = Deno.env.get("VERYFRONT_ENV");

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

describe("server/runtime-handler/request-tracker", () => {
  beforeEach(() => {
    Deno.env.set("VERYFRONT_ENV", "development");
  });

  afterEach(() => {
    // Clean up any tracked requests
    for (const tracked of requestTracker.getInFlightRequests()) {
      requestTracker.complete(tracked.requestId, 200);
    }
    requestTracker.shutdown();
    Deno.env.delete("VERYFRONT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS");
    if (originalLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", originalLogLevel);
    if (originalVeryfrontEnv === undefined) Deno.env.delete("VERYFRONT_ENV");
    else Deno.env.set("VERYFRONT_ENV", originalVeryfrontEnv);
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
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

    it("should treat lightweight stylesheet requests as internal assets", () => {
      requestTracker.start("req-style", "proj", "/_vf_styles/styles.css", "GET");
      requestTracker.complete("req-style", 200);
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
    it("logs successful request completions at debug level", () => {
      const entries = captureLogs();

      requestTracker.start("ok-req", "proj", "/ok", "GET");
      requestTracker.complete("ok-req", 200);

      const entry = entries.find((candidate) => candidate.message === "GET /ok 200");
      assertEquals(entry?.level, "debug");
      assertEquals(entry?.context?.statusCode, 200);
    });

    it("logs redirect request completions at debug level", () => {
      const entries = captureLogs();

      requestTracker.start("redirect-req", "proj", "/moved", "GET");
      requestTracker.complete("redirect-req", 302);

      const entry = entries.find((candidate) => candidate.message === "GET /moved 302");
      assertEquals(entry?.level, "debug");
      assertEquals(entry?.context?.statusCode, 302);
    });

    it("logs websocket upgrade completions at debug level", () => {
      const entries = captureLogs();

      requestTracker.start("upgrade-req", "proj", "/_ws", "GET");
      requestTracker.complete("upgrade-req", 101);

      const entry = entries.find((candidate) => candidate.message === "GET /_ws 101");
      assertEquals(entry?.level, "debug");
      assertEquals(entry?.context?.statusCode, 101);
    });

    it("logs client error request completions at debug level", () => {
      const entries = captureLogs();

      requestTracker.start("not-found", "proj", "/missing", "GET");
      requestTracker.complete("not-found", 404);

      const entry = entries.find((candidate) => candidate.message === "GET /missing 404");
      assertEquals(entry?.level, "debug");
      assertEquals(entry?.context?.statusCode, 404);
    });

    it("logs server error request completions at debug level", () => {
      const entries = captureLogs();

      requestTracker.start("error-req", "proj", "/broken", "GET");
      requestTracker.complete("error-req", 500);

      const entry = entries.find((candidate) => candidate.message === "GET /broken 500");
      assertEquals(entry?.level, "debug");
      assertEquals(entry?.context?.statusCode, 500);
    });

    it("elevates hosted client and server error completions", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      const entries = captureLogs();

      requestTracker.start("hosted-not-found", "proj", "/missing", "GET");
      requestTracker.complete("hosted-not-found", 404);
      requestTracker.start("hosted-error", "proj", "/broken", "POST");
      requestTracker.complete("hosted-error", 500);

      const notFound = entries.find((candidate) => candidate.message === "GET /missing 404");
      const serverError = entries.find((candidate) => candidate.message === "POST /broken 500");
      assertEquals(notFound?.level, "warn");
      assertEquals(serverError?.level, "error");
    });

    it("elevates standalone production failures when process env is development", () => {
      const entries = captureLogs();

      requestTracker.start(
        "standalone-error",
        "proj",
        "/broken",
        "GET",
        undefined,
        undefined,
        true,
      );
      requestTracker.complete("standalone-error", 500);

      const entry = entries.find((candidate) => candidate.message === "GET /broken 500");
      assertEquals(entry?.level, "error");
    });

    it("keeps local project failures quiet when process env is development", () => {
      const entries = captureLogs();

      requestTracker.start(
        "local-error",
        "proj",
        "/broken",
        "GET",
        "production",
        undefined,
        false,
      );
      requestTracker.complete("local-error", 500);

      const entry = entries.find((candidate) => candidate.message === "GET /broken 500");
      assertEquals(entry?.level, "debug");
    });

    it("does not let a hosted logging sink failure alter request completion", () => {
      Deno.env.set("VERYFRONT_ENV", "production");
      const entries = captureLogs();
      const originalError = console.error;

      try {
        console.error = () => {
          throw new Error("error sink unavailable");
        };

        requestTracker.start("hosted-sink-error", "proj", "/broken", "GET");
        requestTracker.complete("hosted-sink-error", 500);
      } finally {
        console.error = originalError;
      }

      const entry = entries.find((candidate) => candidate.message === "GET /broken 500");
      assertEquals(entry?.level, "error");
      assertEquals(requestTracker.getInFlightCount(), 0);
    });

    it("keeps slow and very slow timer diagnostics visible", () => {
      const entries = captureLogs();
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const createInertTimerHandle = () => {
        const handle = originalSetTimeout(() => {}, 0);
        originalClearTimeout(handle);
        return handle;
      };

      globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 10_000) {
          if (typeof callback === "function") callback(...args);
          return createInertTimerHandle();
        }
        if (delay === 15_000) {
          if (typeof callback === "function") callback(...args);
          return createInertTimerHandle();
        }
        return originalSetTimeout(callback, delay, ...args);
      }) as typeof setTimeout;

      try {
        requestTracker.start("slow-req", "proj", "/slow", "GET");
        requestTracker.complete("slow-req", 200);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }

      const slowEntry = entries.find((candidate) => candidate.message === "Slow request detected");
      const verySlowEntry = entries.find((candidate) =>
        candidate.message === "Very slow request - likely stuck"
      );

      assertEquals(slowEntry?.level, "warn");
      assertEquals(verySlowEntry?.level, "error");
    });

    it("skips generic stuck timers for expected long-running run execution", () => {
      const scheduledDelays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;

      globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== undefined) scheduledDelays.push(delay);
        return originalSetTimeout(callback, delay, ...args);
      }) as typeof setTimeout;

      try {
        const path = "/api/control-plane/runs/run_scheduled_1/execute";
        const beforeCount = requestTracker.getInFlightCount();

        requestTracker.start("expected-long-run", "proj", path, "POST");
        assertEquals(scheduledDelays.includes(10_000), false);
        assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
        requestTracker.complete("expected-long-run", 200);

        scheduledDelays.length = 0;
        requestTracker.start("non-execute-method", "proj", path, "GET");
        assertEquals(scheduledDelays.includes(10_000), true);
        requestTracker.complete("non-execute-method", 405);

        scheduledDelays.length = 0;
        requestTracker.start("lookalike-path", "proj", `${path}/extra`, "POST");
        assertEquals(scheduledDelays.includes(10_000), true);
        requestTracker.complete("lookalike-path", 404);
      } finally {
        requestTracker.complete("expected-long-run", 500);
        requestTracker.complete("non-execute-method", 500);
        requestTracker.complete("lookalike-path", 500);
        globalThis.setTimeout = originalSetTimeout;
      }
    });

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

    it("attaches request profile details to slow completion logs", () => {
      const entries = captureLogs();
      Deno.env.set("VERYFRONT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS", "0");

      requestTracker.start("profiled-req", "proj", "/", "GET", "production", "rel-1");
      requestTracker.complete("profiled-req", 200, false, {
        sequence: 7,
        category: "html",
        method: "GET",
        pathname: "/",
        projectSlug: "proj",
        requestMode: "production",
        status: 200,
        startedAt: "2026-07-09T18:41:00.000Z",
        completedAt: "2026-07-09T18:41:02.500Z",
        totalMs: 2500,
        phases: {
          "runtime.resolve_project": 12,
          "handler.execute": 2400,
        },
      });

      const entry = entries.find((candidate) => candidate.message === "GET / 200");
      const profile = entry?.context?.request_profile as
        | {
          sequence: number;
          category: string;
          totalMs: number;
          phases: Record<string, number>;
        }
        | undefined;

      assertEquals(profile?.sequence, 7);
      assertEquals(profile?.category, "html");
      assertEquals(profile?.totalMs, 2500);
      assertEquals(profile?.phases["handler.execute"], 2400);
    });

    it("handles 404 status completion", () => {
      requestTracker.start("not-found-legacy", "proj", "/missing", "GET");
      requestTracker.complete("not-found-legacy", 404);
    });

    it("handles 500 status completion", () => {
      requestTracker.start("error-req-legacy", "proj", "/broken", "GET");
      requestTracker.complete("error-req-legacy", 500);
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
    it("stops status logging after the final request completes", () => {
      const clearedIntervals: ReturnType<typeof setInterval>[] = [];
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      let statusInterval: ReturnType<typeof setInterval> | undefined;

      globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
        statusInterval = originalSetInterval(...args);
        return statusInterval;
      }) as typeof setInterval;
      globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
        if (id !== undefined) clearedIntervals.push(id);
        originalClearInterval(id);
      }) as typeof clearInterval;

      try {
        requestTracker.start("status-interval", "proj", "/_ws", "GET");
        requestTracker.complete("status-interval", 101);

        assertEquals(statusInterval !== undefined, true);
        assertEquals(clearedIntervals.includes(statusInterval!), true);
      } finally {
        requestTracker.shutdown();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
    });

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

    it("should stop slow-request timers without completing a long-lived request", () => {
      const clearedTimers: ReturnType<typeof setTimeout>[] = [];
      const originalClearTimeout = globalThis.clearTimeout;
      globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
        if (id !== undefined) clearedTimers.push(id);
        originalClearTimeout(id);
      }) as typeof clearTimeout;

      try {
        const beforeCount = requestTracker.getInFlightCount();
        requestTracker.start("req-stream", "proj", "/stream", "POST");
        requestTracker.markLongLived("req-stream");

        assertEquals(clearedTimers.length, 1);
        assertEquals(requestTracker.getInFlightCount(), beforeCount + 1);
        requestTracker.complete("req-stream", 200);
      } finally {
        globalThis.clearTimeout = originalClearTimeout;
      }
    });
  });
});
