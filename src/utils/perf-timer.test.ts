import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { endRequest, isEnabled, startRequest, startTimer, timeAsync } from "./perf-timer.ts";

describe("perf-timer", () => {
  describe("isEnabled", () => {
    it("should return a boolean", () => {
      const result = isEnabled();
      assertEquals(typeof result, "boolean");
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
      stop(); // should not throw
    });

    it("should accept optional parent parameter", () => {
      const stop = startTimer("child-label", "parent-label");
      assertEquals(typeof stop, "function");
      stop();
    });
  });

  describe("timeAsync", () => {
    it("should execute and return the result of the async function", async () => {
      const result = await timeAsync("test", () => {
        return 42;
      });
      assertEquals(result, 42);
    });

    it("should propagate errors from the async function", async () => {
      let threw = false;
      try {
        await timeAsync("test", () => {
          throw new Error("test error");
        });
      } catch (e) {
        threw = true;
        assertEquals((e as Error).message, "test error");
      }
      assertEquals(threw, true);
    });

    it("should accept optional parent parameter", async () => {
      const result = await timeAsync("child", () => "ok", "parent");
      assertEquals(result, "ok");
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
