import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { _resetShimForTests, setGlobalMetricsAPI } from "../tracing/api-shim.ts";
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

  afterEach(() => {
    _resetShimForTests();
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

    it("does not publish an in-flight candidate after reset", async () => {
      const meter = {
        createHistogram: () => ({ record() {} }),
        createCounter: () => ({ add() {} }),
        createUpDownCounter: () => ({ add() {} }),
        createObservableGauge: () => ({ addCallback() {} }),
      };
      setGlobalMetricsAPI({ getMeter: () => meter });

      const pending = safeOtelOperation(() => {}, "pending init");
      resetOtelInstruments();
      await pending;

      assertEquals(getOtelInstruments().meter, undefined);
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
    it("initializes after a metrics provider is registered late", async () => {
      _resetShimForTests();
      await safeOtelOperation(() => {}, "before provider");
      let getMeterCalls = 0;
      const meter = {
        createHistogram: () => ({ record() {} }),
        createCounter: () => ({ add() {} }),
        createUpDownCounter: () => ({ add() {} }),
        createObservableGauge: () => ({ addCallback() {} }),
      };
      setGlobalMetricsAPI({
        getMeter: () => {
          getMeterCalls++;
          return meter;
        },
      });

      await safeOtelOperation(() => {}, "after provider");

      assertEquals(getMeterCalls, 1);
      assertEquals(getOtelInstruments().meter, meter);
    });

    it("publishes instruments atomically and retries a failed revision", async () => {
      let shouldFail = true;
      let counterCreations = 0;
      const meter = {
        createHistogram: () => ({ record() {} }),
        createCounter: () => {
          counterCreations++;
          if (shouldFail && counterCreations === 2) {
            throw new Error("transient instrument failure");
          }
          return { add() {} };
        },
        createUpDownCounter: () => ({ add() {} }),
        createObservableGauge: () => ({ addCallback() {} }),
      };
      setGlobalMetricsAPI({ getMeter: () => meter });

      await safeOtelOperation(() => {}, "first attempt");

      assertEquals(getOtelInstruments().meter, undefined);
      assertEquals(getOtelInstruments().requestCounter, undefined);

      shouldFail = false;
      await safeOtelOperation(() => {}, "retry");

      assertEquals(getOtelInstruments().meter, meter);
      assertEquals(typeof getOtelInstruments().requestCounter?.add, "function");
      assertEquals(typeof getOtelInstruments().routeManifestLookupCounter?.add, "function");
    });

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
