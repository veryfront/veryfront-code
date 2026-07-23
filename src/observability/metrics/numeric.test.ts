import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  nonNegativeFiniteMeasure,
  nonNegativeSafeInteger,
  saturatingAdd,
  saturatingAddMeasure,
} from "./numeric.ts";

describe("observability/metrics/numeric", () => {
  it("normalizes all metric values to finite non-negative safe bounds", () => {
    assertEquals(nonNegativeSafeInteger(Number.MAX_VALUE), Number.MAX_SAFE_INTEGER);
    assertEquals(nonNegativeSafeInteger(Number.NaN), 0);
    assertEquals(nonNegativeSafeInteger(-1), 0);
    assertEquals(nonNegativeFiniteMeasure(Number.MAX_VALUE), Number.MAX_SAFE_INTEGER);
    assertEquals(nonNegativeFiniteMeasure(Number.POSITIVE_INFINITY), 0);
    assertEquals(nonNegativeFiniteMeasure(-0.5), 0);
  });

  it("saturates integer and fractional accumulation without overflow", () => {
    assertEquals(saturatingAdd(Number.MAX_SAFE_INTEGER - 1, 10), Number.MAX_SAFE_INTEGER);
    assertEquals(saturatingAdd(Number.NaN, 2.9), 2);
    assertEquals(
      saturatingAddMeasure(Number.MAX_SAFE_INTEGER - 0.5, 1),
      Number.MAX_SAFE_INTEGER,
    );
    assertEquals(saturatingAddMeasure(Number.NaN, 2.5), 2.5);
  });
});
