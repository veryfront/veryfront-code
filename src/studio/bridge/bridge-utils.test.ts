import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { debounce } from "./bridge-utils.ts";

describe("studio/bridge/bridge-utils", () => {
  it("forwards the latest arguments and receiver once", async () => {
    const calls: Array<{ receiver: string; value: number }> = [];
    const debounced = debounce(function (this: { id: string }, value: number) {
      calls.push({ receiver: this.id, value });
    }, 1);

    debounced.call({ id: "first" }, 1);
    debounced.call({ id: "latest" }, 2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(calls, [{ receiver: "latest", value: 2 }]);
  });

  it("cancels pending work", async () => {
    let calls = 0;
    const debounced = debounce(() => calls++, 1);

    debounced();
    debounced.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(calls, 0);
  });

  it("rejects invalid delays", () => {
    assertThrows(() => debounce(() => {}, -1), RangeError, "finite non-negative");
    assertThrows(() => debounce(() => {}, Number.NaN), RangeError, "finite non-negative");
  });
});
