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
});
