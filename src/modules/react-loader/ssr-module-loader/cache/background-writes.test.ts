import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { drainBackgroundWrites, trackBackgroundWrite } from "./redis.ts";

describe("SSR module cache background writes", () => {
  it("waits for a tracked write to settle", async () => {
    const write = Promise.withResolvers<void>();
    trackBackgroundWrite(write.promise);

    let drained = false;
    const draining = drainBackgroundWrites().then(() => {
      drained = true;
    });

    // Give the drain every chance to resolve early if it is not really waiting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(drained, false);

    write.resolve();
    await draining;
    assertEquals(drained, true);
  });

  it("settles even when the tracked write rejects", async () => {
    // A write whose directory disappeared mid-flight rejects. Draining must
    // still complete, and the rejection must not surface as an unhandled one.
    const write = Promise.withResolvers<void>();
    trackBackgroundWrite(write.promise);
    write.reject(new Error("cache directory removed"));

    await drainBackgroundWrites();
  });

  it("returns immediately when nothing is in flight", async () => {
    await drainBackgroundWrites();
  });

  it("waits for a write registered while draining", async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    trackBackgroundWrite(first.promise);

    let drained = false;
    const draining = drainBackgroundWrites().then(() => {
      drained = true;
    });

    // A settling write can publish another one; the drain is only done when
    // nothing at all is left in flight.
    trackBackgroundWrite(second.promise);
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(drained, false);

    second.resolve();
    await draining;
    assertEquals(drained, true);
  });
});
