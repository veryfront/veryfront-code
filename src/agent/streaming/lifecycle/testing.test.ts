import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createScriptedStreamProvider, ManualMonotonicClock } from "./testing.ts";

describe("stream lifecycle testing adapters", () => {
  it("releases only deadlines reached by a monotonic advance", async () => {
    const clock = new ManualMonotonicClock();
    const first = clock.waitUntil(10);
    const second = clock.waitUntil(20);
    clock.advanceBy(10);
    assertEquals(await first, "deadline");
    assertEquals(clock.pendingWaitCount, 1);
    clock.advanceBy(10);
    assertEquals(await second, "deadline");
  });

  it("records one provider open and one cleanup request", async () => {
    const provider = createScriptedStreamProvider([{
      type: "text-delta",
      text: "ok",
    }]);
    const iterator = provider.open(new AbortController().signal)
      [Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    assertEquals(provider.openCount, 1);
    assertEquals(provider.returnCount, 1);
  });
});
