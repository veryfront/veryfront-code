import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "./timer.ts";
import { DEFAULT_PERMIT_SEMAPHORE_MAX_QUEUE_SIZE, PermitSemaphore } from "./permit-semaphore.ts";

describe("PermitSemaphore", () => {
  it("rejects invalid permit and queue capacities", () => {
    for (const permits of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(() => new PermitSemaphore(permits), RangeError);
    }
    for (
      const maxQueueSize of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]
    ) {
      assertThrows(
        () => new PermitSemaphore(1, { maxQueueSize }),
        RangeError,
      );
    }
  });

  it("rejects timeout values outside the portable timer domain", async () => {
    const semaphore = new PermitSemaphore(0);
    for (
      const timeoutMs of [
        -1,
        0.5,
        Number.NaN,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      await assertRejects(() => semaphore.tryAcquire(timeoutMs), RangeError);
    }
  });

  it("uses a finite default queue budget", () => {
    const semaphore = new PermitSemaphore(1);
    assertEquals(
      semaphore.queueCapacity,
      DEFAULT_PERMIT_SEMAPHORE_MAX_QUEUE_SIZE,
    );
    assertEquals(Number.isFinite(semaphore.queueCapacity), true);
  });

  it("reports capacity and grants queued permits in FIFO order", async () => {
    const semaphore = new PermitSemaphore(1);
    assertEquals(semaphore.capacity, 1);
    assertEquals(await semaphore.tryAcquire(), true);

    const order: number[] = [];
    const first = semaphore.tryAcquire(1_000).then((acquired) => {
      if (acquired) order.push(1);
      return acquired;
    });
    const second = semaphore.tryAcquire(1_000).then((acquired) => {
      if (acquired) order.push(2);
      return acquired;
    });

    semaphore.release();
    assertEquals(await first, true);
    semaphore.release();
    assertEquals(await second, true);
    assertEquals(order, [1, 2]);
  });

  it("refuses to enqueue past the queue budget", async () => {
    const semaphore = new PermitSemaphore(0, { maxQueueSize: 2 });
    const first = semaphore.tryAcquire(Number.POSITIVE_INFINITY);
    const second = semaphore.tryAcquire(Number.POSITIVE_INFINITY);

    assertEquals(semaphore.waiting, 2, "both waiters must be queued");

    const refused = semaphore.tryAcquire(1_000);
    assertEquals(
      semaphore.waiting,
      2,
      "a refused acquisition must not grow the queue",
    );
    assertEquals(
      await refused,
      false,
      "an acquisition past the queue budget must be refused instead of queued",
    );

    semaphore.release();
    assertEquals(await first, true, "the first queued waiter must be granted a permit");
    semaphore.release();
    assertEquals(await second, true, "the second queued waiter must be granted a permit");
    assertEquals(semaphore.waiting, 0, "the queue must drain once both waiters are granted");
  });

  it("reports failure and dequeues a waiter whose timeout expires", async () => {
    const semaphore = new PermitSemaphore(0);

    assertEquals(
      await semaphore.tryAcquire(5),
      false,
      "an expired wait must report that no permit was granted",
    );
    assertEquals(semaphore.waiting, 0, "a timed-out waiter must leave the queue");
    assertEquals(semaphore.available, 0, "a timed-out waiter must not consume a permit");

    assertEquals(
      await semaphore.tryAcquire(0),
      false,
      "a zero timeout must fail immediately",
    );
    assertEquals(semaphore.waiting, 0, "a zero timeout must not enqueue a waiter");
  });

  it("creates a permit when released with no waiter queued", async () => {
    const semaphore = new PermitSemaphore(0);
    assertEquals(semaphore.available, 0, "a zero-permit gate starts with no permit");

    semaphore.release();

    assertEquals(
      semaphore.available,
      1,
      "a release with no waiter must create a permit",
    );
    assertEquals(
      await semaphore.tryAcquire(0),
      true,
      "the permit created by an unqueued release must be acquirable without waiting",
    );
    assertEquals(semaphore.available, 0, "acquiring the created permit consumes it");
  });

  it("normalizes primitive abort reasons before and during acquisition", async () => {
    const semaphore = new PermitSemaphore(0);
    const preflight = new AbortController();
    preflight.abort("preflight cancelled");
    await assertRejects(
      () => semaphore.tryAcquire(Number.POSITIVE_INFINITY, { signal: preflight.signal }),
      DOMException,
      "preflight cancelled",
    );

    const queued = new AbortController();
    const acquisition = semaphore.tryAcquire(Number.POSITIVE_INFINITY, {
      signal: queued.signal,
    });
    assertEquals(semaphore.waiting, 1);
    queued.abort("queued acquisition cancelled");
    await assertRejects(
      () => acquisition,
      DOMException,
      "queued acquisition cancelled",
    );
    assertEquals(semaphore.waiting, 0);
  });
});
