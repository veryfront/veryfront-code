import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RuntimeGenerationDrain } from "./runtime-generation-drain.ts";

describe("runtime generation drain", () => {
  it("stops admission and waits for active leases", async () => {
    const drain = new RuntimeGenerationDrain();
    const lease = drain.tryAcquire();
    assertEquals(lease !== undefined, true);

    let closed = false;
    const closing = drain.close().then(() => {
      closed = true;
    });
    await Promise.resolve();

    assertEquals(drain.tryAcquire(), undefined);
    assertEquals(closed, false);

    lease!.release();
    await closing;
    assertEquals(closed, true);
  });

  it("waits for hidden work after its response lease is released", async () => {
    const drain = new RuntimeGenerationDrain();
    const lease = drain.tryAcquire()!;
    const underlying = Promise.withResolvers<void>();
    lease.track(underlying.promise);
    lease.release();

    let closed = false;
    const closing = drain.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    assertEquals(closed, false);

    underlying.resolve();
    await closing;
    assertEquals(closed, true);
  });

  it("shares close attempts and makes lease release idempotent", async () => {
    const drain = new RuntimeGenerationDrain();
    const lease = drain.tryAcquire()!;
    const first = drain.close();
    const second = drain.close();

    lease.release();
    lease.release();

    assertEquals(first, second);
    await Promise.all([first, second]);
  });

  it("rejects background registration after a lease is released", async () => {
    const drain = new RuntimeGenerationDrain();
    const lease = drain.tryAcquire()!;
    lease.release();

    await assertRejects(
      () => Promise.resolve().then(() => lease.track(Promise.resolve())),
      Error,
      "released runtime generation lease",
    );
  });
});
