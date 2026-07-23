import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "./async.ts";

describe("platform/compat/std/async", () => {
  it("rejects immediately when the supplied signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("delay cancelled");
    controller.abort(reason);

    let rejectedWith: unknown;
    try {
      await delay(20, { signal: controller.signal });
    } catch (error) {
      rejectedWith = error;
    }

    assertEquals(rejectedWith, reason);
  });

  it("cancels a delay after its timer has been scheduled", async () => {
    const controller = new AbortController();
    const reason = new Error("scheduled delay cancelled");
    const pending = delay(1_000, { signal: controller.signal });
    controller.abort(reason);

    let rejectedWith: unknown;
    try {
      await pending;
    } catch (error) {
      rejectedWith = error;
    }

    assertEquals(rejectedWith, reason);
  });
});
