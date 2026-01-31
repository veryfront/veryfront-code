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
});
