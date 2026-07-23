import { assertEquals, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { withEnv } from "./deno-compat.ts";
import { getTestTimeScale, scaleMs } from "./timing.ts";

describe("testing/timing", () => {
  it("rejects durations that could create immediate or unbounded timers", () => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assertThrows(() => scaleMs(duration), RangeError);
    }
    for (const minimum of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assertThrows(() => scaleMs(10, minimum), RangeError);
    }
  });

  it("falls back for invalid scale configuration and rejects overflow", async () => {
    await withEnv({ VF_TEST_TIME_SCALE: "invalid" }, async () => {
      assertEquals(getTestTimeScale(), 1);
      assertEquals(scaleMs(10), 10);
    });

    await withEnv({ VF_TEST_TIME_SCALE: String(Number.MAX_VALUE) }, async () => {
      assertThrows(() => scaleMs(2), RangeError);
    });
  });
});
