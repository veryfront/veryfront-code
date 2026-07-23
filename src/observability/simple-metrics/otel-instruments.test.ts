import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getOtelInstruments,
  resetOtelInstruments,
  safeLogWarn,
  safeOtelOperation,
} from "./otel-instruments.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  _resetShimForTests,
  type Meter,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";

describe("observability/simple-metrics/otel-instruments", () => {
  beforeEach(() => {
    _resetShimForTests();
    resetOtelInstruments();
  });

  afterEach(() => {
    _resetShimForTests();
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

    it("records only a bounded failure category", () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      class PrivateMetricsCanaryError extends Error {}

      try {
        safeLogWarn(
          "bounded warning",
          new PrivateMetricsCanaryError("private-metrics-error-canary"),
        );
      } finally {
        __resetLogRecordEmitterForTests();
      }

      assertEquals(entries.at(-1)?.context?.failure_category, "error");
      assertEquals(JSON.stringify(entries).includes("private-metrics-error-canary"), false);
      assertEquals(JSON.stringify(entries).includes("PrivateMetricsCanaryError"), false);
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

    it("initializes after the metrics API is registered late", async () => {
      await safeOtelOperation(() => {}, "before registration");
      assertEquals(getOtelInstruments().meter, undefined);

      const instrument = {
        add() {},
        record() {},
        addCallback() {},
      };
      const meter = {
        createCounter: () => instrument,
        createHistogram: () => instrument,
      } as unknown as Meter;
      setGlobalMetricsAPI({ getMeter: () => meter });

      await safeOtelOperation(() => {}, "after registration");

      assertEquals(getOtelInstruments().meter, meter);
    });
  });
});
