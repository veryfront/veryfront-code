import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getOtelInstruments,
  resetOtelInstruments,
  safeLogWarn,
  safeOtelOperation,
} from "./otel-instruments.ts";

describe("observability/simple-metrics/otel-instruments", () => {
  beforeEach(() => {
    resetOtelInstruments();
  });

  describe("getOtelInstruments", () => {
    it("should return an instruments object", () => {
      const instruments = getOtelInstruments();
      assertEquals(typeof instruments, "object");
    });

    it("should return empty object before initialization", () => {
      const instruments = getOtelInstruments();
      assertEquals(instruments.meter, undefined);
      assertEquals(instruments.ssrHistogram, undefined);
      assertEquals(instruments.requestCounter, undefined);
    });
  });

  describe("resetOtelInstruments", () => {
    it("should clear all instruments", () => {
      const instruments = getOtelInstruments();
      // Manually set something to verify reset
      (instruments as Record<string, unknown>).meter = "fake-meter";
      resetOtelInstruments();
      assertEquals(getOtelInstruments().meter, undefined);
    });

    it("should be callable multiple times", () => {
      resetOtelInstruments();
      resetOtelInstruments();
      resetOtelInstruments();
      // Should not throw
    });

    it("should allow re-initialization after reset", async () => {
      // Attempt initialization (may fail in test env without OTel)
      await safeOtelOperation(() => {}, "test");
      resetOtelInstruments();
      // Second call should work too
      await safeOtelOperation(() => {}, "test");
    });
  });

  describe("safeLogWarn", () => {
    it("should not throw when logging a message", () => {
      safeLogWarn("test warning");
      // Should not throw
    });

    it("should not throw when logging with error", () => {
      safeLogWarn("test warning", new Error("test error"));
      // Should not throw
    });

    it("should not throw when logging with non-Error", () => {
      safeLogWarn("test warning", "string error");
      // Should not throw
    });
  });

  describe("safeOtelOperation", () => {
    it("should execute the operation", async () => {
      let executed = false;
      await safeOtelOperation(() => {
        executed = true;
      }, "test op");
      assertEquals(executed, true);
    });

    it("should not throw when operation fails", async () => {
      await safeOtelOperation(() => {
        throw new Error("operation failed");
      }, "failing op");
      // Should not throw
    });

    it("should not throw when operation rejects", async () => {
      await safeOtelOperation(() => Promise.reject(new Error("async failure")), "async failing op");
      // Should not throw
    });

    it("should handle void operations", async () => {
      await safeOtelOperation(() => {}, "void op");
      // Should not throw
    });
  });
});
