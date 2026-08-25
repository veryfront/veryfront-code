import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sleep } from "./sleep.ts";

describe("sleep", () => {
  it("throws for delays unsupported by JavaScript timers", () => {
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

  it("resolves zero-delay sleeps", async () => {
    assertEquals(await sleep(0), undefined);
  });

  it("resolves fractional retry jitter delays", async () => {
    assertEquals(await sleep(0.1), undefined);
  });

  it("throws the abort reason without scheduling a timer when already aborted", () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);

    const thrown = assertThrows(
      () => sleep(60_000, controller.signal),
      Error,
      "stop",
    );

    assertStrictEquals(
      thrown,
      reason,
      "an already aborted signal must throw its exact reason synchronously",
    );
  });

  it("rejects with the abort reason when aborted while waiting", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const pending = sleep(60_000, controller.signal);
    controller.abort(reason);

    const rejection = await assertRejects(() => pending, Error, "stop");

    assertStrictEquals(
      rejection,
      reason,
      "sleep must reject with the exact abort reason",
    );
  });
});
