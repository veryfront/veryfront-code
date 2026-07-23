import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { initializeInstruments } from "./instruments-factory.ts";

describe("observability/instruments/instruments-factory", () => {
  it("keeps independent instrument groups available after one group fails", () => {
    const instrument = {
      add() {},
      record() {},
      addCallback() {},
    };
    const meter = {
      createCounter(name: string) {
        if (name === "veryfront.http.requests") {
          throw new Error("unsupported counter");
        }
        return instrument;
      },
      createHistogram: () => instrument,
      createUpDownCounter: () => instrument,
      createObservableGauge: () => instrument,
    } as unknown as Meter;

    const instruments = initializeInstruments(
      meter,
      {
        enabled: true,
        exporter: "console",
        prefix: "veryfront",
        collectInterval: 60_000,
        debug: false,
      },
      { cacheSize: 0, activeRequests: 0 },
    );

    assertEquals(instruments.httpRequestCounter, null);
    assertExists(instruments.cacheGetCounter);
    assertExists(instruments.renderCounter);
    assertExists(instruments.errorCounter);
  });
});
