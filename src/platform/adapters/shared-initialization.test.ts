import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  drainSharedInitialization,
  isSharedInitializationAborted,
  joinSharedInitialization,
  onSharedInitializationSettled,
  startSharedInitialization,
} from "./shared-initialization.ts";

describe("shared initialization", () => {
  it("rejects a cancelled caller while a healthy peer retains the physical flight", async () => {
    const drain = Promise.withResolvers<void>();
    const controller = new AbortController();
    const flight = startSharedInitialization(() => drain.promise);
    const cancelled = joinSharedInitialization(flight, controller.signal);
    const healthy = joinSharedInitialization(flight);
    const rejection = assertRejects(() => cancelled, Error);
    controller.abort();
    await rejection;
    assertEquals(flight.waiters, 1);
    assertEquals(flight.settled, false);
    assertEquals(isSharedInitializationAborted(flight), false);
    drain.resolve();
    await healthy;
    assertEquals(flight.waiters, 0);
    assertEquals(flight.settled, true);
  });

  it("runs settlement callbacks and marks failed flights settled", async () => {
    const failure = new Error("initialization failed");
    const drain = Promise.withResolvers<void>();
    const flight = startSharedInitialization(async () => {
      await drain.promise;
      throw failure;
    });
    let callbacks = 0;

    onSharedInitializationSettled(flight, () => {
      callbacks++;
    });

    drain.resolve();
    await assertRejects(() => flight.promise, Error, "initialization failed");
    await drainSharedInitialization(flight);

    assertEquals(callbacks, 1);
    assertEquals(flight.settled, true);
  });

  it("lets a caller abort while draining an abandoned physical flight", async () => {
    const drain = Promise.withResolvers<void>();
    const flight = startSharedInitialization(() => drain.promise);
    const owner = new AbortController();
    const abandoned = joinSharedInitialization(flight, owner.signal);
    const rejected = assertRejects(() => abandoned, Error);
    owner.abort();
    await rejected;
    assertEquals(isSharedInitializationAborted(flight), true);
    assertEquals(flight.settled, false);

    const waiter = new AbortController();
    const drained = drainSharedInitialization(flight, waiter.signal);
    const drainRejected = assertRejects(() => drained, Error);
    waiter.abort();
    await drainRejected;
    assertEquals(flight.settled, false);
    drain.resolve();
    await drainSharedInitialization(flight);
    assertEquals(flight.settled, true);
  });
});
