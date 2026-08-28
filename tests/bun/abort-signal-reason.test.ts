import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Bun AbortSignal reason", () => {
  it("exposes the supplied Error reason as soon as abort sets the signal state", () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped waiting");

    controller.abort(reason);

    assertEquals(controller.signal.aborted, true);
    assertStrictEquals(
      controller.signal.reason,
      reason,
      "AbortSignal.reason must retain the supplied Error by identity immediately after abort()",
    );
  });
});
