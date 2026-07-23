import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Meter, ObservableResult } from "#veryfront/observability/tracing/api-shim.ts";
import { disposeInstruments, initializeInstruments } from "./instruments-factory.ts";

describe("observability/instruments/instruments-factory", () => {
  it("does not leak observable callbacks from a partial initialization and remains retryable", () => {
    const callbacks = new Set<(result: ObservableResult) => void>();
    let failRenderFamily = true;
    const writableInstrument = { add() {}, record() {} };
    const meter: Meter = {
      createCounter: () => writableInstrument,
      createUpDownCounter: () => writableInstrument,
      createHistogram: (name) => {
        if (failRenderFamily && name.includes(".render.duration")) {
          throw new Error("render histogram unavailable");
        }
        return writableInstrument;
      },
      createObservableGauge: () => ({
        addCallback: (callback) => callbacks.add(callback),
        removeCallback: (callback) => callbacks.delete(callback),
      }),
    };
    const config = {
      enabled: true,
      exporter: "console" as const,
      prefix: "test",
    };
    const runtimeState = { cacheSize: 0, activeRequests: 0 };

    const failed = initializeInstruments(meter, config, runtimeState);

    assertEquals(failed.cacheSizeGauge, null);
    assertEquals(callbacks.size, 0);

    failRenderFamily = false;
    const initialized = initializeInstruments(meter, config, runtimeState);
    assertNotEquals(initialized.cacheSizeGauge, null);
    assertEquals(callbacks.size, 5);

    disposeInstruments(initialized);
    assertEquals(callbacks.size, 0);
  });
});
