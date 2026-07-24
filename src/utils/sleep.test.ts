import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sleep } from "./sleep.ts";

describe("sleep", () => {
  it("rejects delays unsupported by JavaScript timers", () => {
    for (
      const delayMs of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        2_147_483_648,
      ]
    ) {
      assertThrows(() => sleep(delayMs), RangeError);
    }
  });

  it("allows a zero-delay asynchronous yield", async () => {
    assertEquals(await sleep(0), undefined);
  });

  it("accepts fractional retry jitter without scheduling it early", async () => {
    assertEquals(await sleep(0.1), undefined);
  });
});
