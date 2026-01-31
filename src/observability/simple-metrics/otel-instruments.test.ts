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
      assertEquals(typeof getOtelInstruments(), "object");
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
      instruments.meter = "fake-meter" as never;

      resetOtelInstruments();

      assertEquals(getOtelInstruments().meter, undefined);
    });

    it("should be callable multiple times", () => {
      resetOtelInstruments();
      resetOtelInstruments();
      resetOtelInstruments();
    });

    it("should allow re-initialization after reset", async () => {
      await safeOtelOperation(() => {}, "test");
      resetOtelInstruments();
      await safeOtelOperation(() => {}, "test");
    });
  });

  describe("safeLogWarn", () => {
    it("should not throw when logging a message", () => {
      safeLogWarn("test warning");
    });

    it("should not throw when logging with error", () => {
      safeLogWarn("test warning", new Error("test error"));
    });

    it("should not throw when logging with non-Error", () => {
      safeLogWarn("test warning", "string error");
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
    });

    it("should not throw when operation rejects", async () => {
      await safeOtelOperation(
        () => Promise.reject(new Error("async failure")),
        "async failing op",
      );
    });

    it("should handle void operations", async () => {
      await safeOtelOperation(() => {}, "void op");
    });
  });
});
