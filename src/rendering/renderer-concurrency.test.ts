import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Mutex } from "./renderer-concurrency.ts";

describe("Mutex", () => {
  it("acquires immediately when unlocked", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    assertEquals(typeof release, "function");
    release();
  });

  it("serializes concurrent access", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const release1 = await mutex.acquire();
    assertEquals(mutex.waiting, 0);

    // Second acquire should queue
    const p2 = mutex.acquire().then((release) => {
      order.push(2);
      release();
    });

    // Third acquire should also queue
    const p3 = mutex.acquire().then((release) => {
      order.push(3);
      release();
    });

    assertEquals(mutex.waiting, 2);

    // Release first lock — should wake waiters in order
    order.push(1);
    release1();

    await p2;
    await p3;

    assertEquals(order, [1, 2, 3]);
  });

  it("allows re-acquisition after release", async () => {
    const mutex = new Mutex();

    const release1 = await mutex.acquire();
    release1();

    const release2 = await mutex.acquire();
    release2();

    // Should not deadlock or throw
    assertEquals(mutex.waiting, 0);
  });

  it("times out when lock is held too long", async () => {
    const mutex = new Mutex();

    // Hold the lock indefinitely
    const _release = await mutex.acquire();

    await assertRejects(
      () => mutex.acquire(10),
      Error,
      "Lock acquisition timeout",
    );

    assertEquals(mutex.waiting, 0);

    _release();
  });

  it("does not resolve timed-out waiter when lock is released", async () => {
    const mutex = new Mutex();
    const events: string[] = [];

    const release1 = await mutex.acquire();

    // This will timeout
    const timedOut = mutex.acquire(10).then(
      (release) => {
        events.push("should-not-happen");
        release();
      },
      () => {
        events.push("timeout");
      },
    );

    await timedOut;
    assertEquals(events, ["timeout"]);

    // Release original lock — the timed-out waiter should NOT be notified
    release1();

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 5));
    assertEquals(events, ["timeout"]);
  });

  it("handles concurrent acquire and release without deadlock", async () => {
    const mutex = new Mutex();
    let counter = 0;

    const tasks = Array.from({ length: 20 }, async () => {
      const release = await mutex.acquire();
      counter++;
      release();
    });

    await Promise.all(tasks);
    assertEquals(counter, 20);
  });
});

describe("project render slots", () => {
  it("does not delete a held project mutex while waiters are queued", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    const originalDelete = Map.prototype.delete;
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?queued-slot-race=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;
      let projectDeleteCount = 0;
      let competingAcquire: Promise<boolean> | undefined;

      Map.prototype.delete = function patchedDelete<K, V>(
        this: Map<K, V>,
        key: K,
      ): boolean {
        const result = originalDelete.call(this, key);
        if (key === projectId) {
          projectDeleteCount++;
          if (projectDeleteCount === 2) {
            competingAcquire = concurrency.acquireProjectSlot(projectId);
          }
        }
        return result;
      };

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);

      const releasing = concurrency.releaseProjectSlot(projectId);
      const queuedAcquire = concurrency.acquireProjectSlot(projectId);

      await releasing;
      competingAcquire ??= concurrency.acquireProjectSlot(projectId);

      assertEquals(await queuedAcquire, true);
      assertEquals(await competingAcquire, false);
    } finally {
      Map.prototype.delete = originalDelete;
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
    }
  });
});
