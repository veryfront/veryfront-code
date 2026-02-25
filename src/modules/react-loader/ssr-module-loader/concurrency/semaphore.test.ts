import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Semaphore } from "./semaphore.ts";

describe("modules/react-loader/ssr-module-loader/concurrency/semaphore", () => {
  describe("Semaphore", () => {
    it("should acquire immediately when permits available", async () => {
      const sem = new Semaphore(2);

      assertEquals(await sem.tryAcquire(), true);
      assertEquals(sem.available, 1);
    });

    it("should decrement permits on acquire", async () => {
      const sem = new Semaphore(3);

      await sem.tryAcquire();
      await sem.tryAcquire();

      assertEquals(sem.available, 1);
    });

    it("should timeout when no permits available", async () => {
      const sem = new Semaphore(1);

      await sem.tryAcquire();
      assertEquals(sem.available, 0);

      const result = await sem.tryAcquire(10);
      assertEquals(result, false);
    });

    it("should release permits", async () => {
      const sem = new Semaphore(1);

      await sem.tryAcquire();
      assertEquals(sem.available, 0);

      sem.release();
      assertEquals(sem.available, 1);
    });

    it("should wake waiting acquirer on release", async () => {
      const sem = new Semaphore(1);
      await sem.tryAcquire();

      const acquirePromise = sem.tryAcquire(500);
      assertEquals(sem.waiting, 1);

      sem.release();

      assertEquals(await acquirePromise, true);
      assertEquals(sem.waiting, 0);
    });

    it("should report waiting count", async () => {
      const sem = new Semaphore(0);

      assertEquals(sem.waiting, 0);

      const p1 = sem.tryAcquire(50);
      const p2 = sem.tryAcquire(50);

      assertEquals(sem.waiting, 2);

      await Promise.all([p1, p2]);
    });

    it("should remove timed-out waiters from queue", async () => {
      const sem = new Semaphore(1);

      await sem.tryAcquire();
      const timedOutAcquire = sem.tryAcquire(5);

      assertEquals(await timedOutAcquire, false);
      assertEquals(sem.waiting, 0);

      sem.release();
      assertEquals(sem.available, 1);
    });

    it("should reject immediately when queue is at max size", async () => {
      const sem = new Semaphore(1, { maxQueueSize: 2 });

      // Exhaust the single permit
      await sem.tryAcquire();

      // Fill the queue to capacity
      const p1 = sem.tryAcquire(500);
      const p2 = sem.tryAcquire(500);
      assertEquals(sem.waiting, 2);

      // Next acquire should be rejected immediately (queue full)
      const rejected = await sem.tryAcquire(500);
      assertEquals(rejected, false);
      assertEquals(sem.waiting, 2);

      // Release all to clean up
      sem.release();
      sem.release();
      assertEquals(await p1, true);
      assertEquals(await p2, true);
    });

    it("should accept new waiters after queue drains below max", async () => {
      const sem = new Semaphore(1, { maxQueueSize: 1 });

      await sem.tryAcquire();

      // Fill the single queue slot
      const p1 = sem.tryAcquire(500);
      assertEquals(sem.waiting, 1);

      // Queue is full
      assertEquals(await sem.tryAcquire(500), false);

      // Release permit — wakes p1, queue drains
      sem.release();
      assertEquals(await p1, true);
      assertEquals(sem.waiting, 0);

      // Now a new waiter can queue again
      const p2 = sem.tryAcquire(500);
      assertEquals(sem.waiting, 1);

      sem.release();
      assertEquals(await p2, true);
    });

    it("should have unbounded queue by default", async () => {
      const sem = new Semaphore(1);

      await sem.tryAcquire();

      // Queue many waiters — should all be accepted
      const promises = Array.from({ length: 50 }, () => sem.tryAcquire(500));
      assertEquals(sem.waiting, 50);

      // Release all
      for (let i = 0; i < 50; i++) sem.release();
      const results = await Promise.all(promises);
      assertEquals(results.every((r) => r === true), true);
    });
  });
});
