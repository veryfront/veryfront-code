import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { calculateHeapUtilizationPercent } from "./memory-instruments.ts";

describe("observability/instruments/memory-instruments", () => {
  it("uses the runtime heap limit when it is available", () => {
    assertEquals(calculateHeapUtilizationPercent(250, 500, 1_000), 25);
  });

  it("falls back to allocated heap instead of a hardcoded runtime limit", () => {
    assertEquals(calculateHeapUtilizationPercent(250, 500, null), 50);
  });

  it("rejects invalid measurements and bounds utilization", () => {
    assertEquals(calculateHeapUtilizationPercent(Number.NaN, 500, 1_000), null);
    assertEquals(calculateHeapUtilizationPercent(100, 0, null), null);
    assertEquals(calculateHeapUtilizationPercent(2_000, 500, 1_000), 100);
  });
});
