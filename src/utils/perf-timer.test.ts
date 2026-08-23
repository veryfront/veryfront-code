import "#veryfront/schemas/_test-setup.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { endRequest, isEnabled, startRequest, startTimer, timeAsync } from "./perf-timer.ts";

describe("perf-timer", () => {
  describe("isEnabled", () => {
    it("should return a boolean", () => {
      assertEquals(typeof isEnabled(), "boolean");
    });
  });

  describe("startRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      startRequest("test-request-1");
    });
  });

  describe("endRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      endRequest("test-request-1");
    });

    it("should not throw for unknown request ID", () => {
      endRequest("nonexistent-request");
    });
  });

  describe("startTimer (disabled mode)", () => {
    it("should return a no-op function", () => {
      const stop = startTimer("test-label");
      assertEquals(typeof stop, "function");
      stop();
    });

    it("should accept optional parent parameter", () => {
      const stop = startTimer("child-label", "parent-label");
      assertEquals(typeof stop, "function");
      stop();
    });
  });

  describe("timeAsync", () => {
    it("should execute and return the result of the async function", async () => {
      assertEquals(await timeAsync("test", () => Promise.resolve(42)), 42);
    });

    it("should propagate errors from the async function", async () => {
      try {
        await timeAsync("test", () => {
          throw new Error("test error");
        });
        assertEquals(true, false);
      } catch (e) {
        assertEquals((e as Error).message, "test error");
      }
    });

    it("should accept optional parent parameter", async () => {
      assertEquals(await timeAsync("child", () => Promise.resolve("ok"), "parent"), "ok");
    });

    it("should handle promises that resolve after delay", async () => {
      const result = await timeAsync("delayed", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "delayed-result";
      });
      assertEquals(result, "delayed-result");
    });
  });

  // The module memoizes its enabled flag on first use, and every describe above
  // runs in disabled mode, so the enabled path needs a fresh module instance.
  describe("enabled mode", () => {
    it("should enable request timing when VERYFRONT_PERF is '1'", async () => {
      const previous = getEnv("VERYFRONT_PERF");
      setEnv("VERYFRONT_PERF", "1");

      try {
        const perf = await import("./perf-timer.ts?enabled=1");

        assertEquals(perf.isEnabled(), true, "VERYFRONT_PERF=1 must enable request timing");

        perf.startRequest("enabled-request");
        const stop = perf.startTimer("total");
        stop();
        const child = perf.startTimer("render", "total");
        child();
        assertEquals(
          await perf.timeAsync("fetch", () => Promise.resolve("value"), "total"),
          "value",
          "an enabled timer still returns the wrapped result",
        );
        perf.endRequest("enabled-request");
        // The second call must find no timings: endRequest deletes the request
        // entry, so a repeat report is a no-op rather than a throw.
        perf.endRequest("enabled-request");
      } finally {
        if (previous === undefined) {
          deleteEnv("VERYFRONT_PERF");
        } else {
          setEnv("VERYFRONT_PERF", previous);
        }
      }
    });
  });
});
