import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Mutex } from "./renderer-concurrency.ts";

function abortBeforeListenerRegistration(
  controller: AbortController,
  reason: DOMException,
): AbortSignal {
  return new Proxy(controller.signal, {
    get(target, property) {
      if (property === "addEventListener") controller.abort(reason);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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
  it("falls back to safe limits when concurrency env values are invalid", async () => {
    const previousMax = Deno.env.get("RENDER_MAX_CONCURRENT");
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    const previousQueueSize = Deno.env.get("RENDER_PER_PROJECT_QUEUE_SIZE");
    Deno.env.set("RENDER_MAX_CONCURRENT", "3");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "not-a-number");
    Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", "not-a-number");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?invalid-limits=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;

      assertEquals(concurrency.RENDER_MAX_CONCURRENT, 3);
      assertEquals(concurrency.RENDER_PER_PROJECT_LIMIT, 1);
      assertEquals(concurrency.RENDER_PER_PROJECT_QUEUE_SIZE, 1);
      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      for (
        const [name, previous] of [
          ["RENDER_MAX_CONCURRENT", previousMax],
          ["RENDER_PER_PROJECT_LIMIT", previousLimit],
          ["RENDER_PER_PROJECT_QUEUE_SIZE", previousQueueSize],
        ] as const
      ) {
        if (previous === undefined) {
          Deno.env.delete(name);
        } else {
          Deno.env.set(name, previous);
        }
      }
    }
  });

  it("disables per-project limits when RENDER_PER_PROJECT_LIMIT is 0", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "0");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?zero-limit=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;

      assertEquals(
        concurrency.RENDER_PER_PROJECT_LIMIT,
        0,
        "an explicit 0 must survive parsing",
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        assertEquals(
          await concurrency.acquireProjectSlot(projectId),
          true,
          "a disabled per-project limit must never refuse a render slot",
        );
      }

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(
        concurrency.projectRenderCounts.has(projectId),
        false,
        "the disabled path must not record per-project counts",
      );
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
    }
  });

  it("queues foreground waiters in FIFO order", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    const previousQueueSize = Deno.env.get("RENDER_PER_PROJECT_QUEUE_SIZE");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", "2");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?fifo-slots=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;
      const order: number[] = [];

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      const second = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
      }).then((acquired: boolean) => {
        if (acquired) order.push(2);
        return acquired;
      });
      const third = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
      }).then((acquired: boolean) => {
        if (acquired) order.push(3);
        return acquired;
      });

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await second, true);
      assertEquals(order, [2]);

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await third, true);
      assertEquals(order, [2, 3]);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
      if (previousQueueSize === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_QUEUE_SIZE");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", previousQueueSize);
      }
    }
  });

  it("times out and removes a queued foreground waiter", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?timeout-slot=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      assertEquals(
        await concurrency.acquireProjectSlot(projectId, {
          wait: true,
          timeoutMs: 5,
        }),
        false,
      );

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
    }
  });

  it("aborts and removes a queued foreground waiter", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?abort-slot=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;
      const controller = new AbortController();

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      const waiting = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
        signal: controller.signal,
      });
      controller.abort(new DOMException("request cancelled", "AbortError"));

      await assertRejects(
        () => waiting,
        DOMException,
        "request cancelled",
      );
      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
    }
  });

  it("rejects an abort missed immediately before listener registration", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?abort-registration-slot=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;
      const controller = new AbortController();
      const reason = new DOMException("registration race", "AbortError");

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      try {
        await assertRejects(
          () =>
            concurrency.acquireProjectSlot(projectId, {
              wait: true,
              timeoutMs: 10,
              signal: abortBeforeListenerRegistration(controller, reason),
            }),
          DOMException,
          "registration race",
        );
      } finally {
        await concurrency.releaseProjectSlot(projectId);
      }

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
    }
  });

  it("grants a released slot past an aborted head waiter", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    const previousQueueSize = Deno.env.get("RENDER_PER_PROJECT_QUEUE_SIZE");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", "2");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?aborted-head-slot=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;
      const controller = new AbortController();

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      const abortedWaiter = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
        signal: controller.signal,
      });
      const nextWaiter = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
      });

      controller.abort(new DOMException("head waiter cancelled", "AbortError"));
      await assertRejects(
        () => abortedWaiter,
        DOMException,
        "head waiter cancelled",
      );

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await nextWaiter, true);
      await concurrency.releaseProjectSlot(projectId);

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
      if (previousQueueSize === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_QUEUE_SIZE");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", previousQueueSize);
      }
    }
  });

  it("rejects immediately when the foreground queue is full", async () => {
    const previousLimit = Deno.env.get("RENDER_PER_PROJECT_LIMIT");
    const previousQueueSize = Deno.env.get("RENDER_PER_PROJECT_QUEUE_SIZE");
    Deno.env.set("RENDER_PER_PROJECT_LIMIT", "1");
    Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", "1");
    try {
      const concurrency = await import(
        `./renderer-concurrency.ts?full-slot=${crypto.randomUUID()}`
      );
      const projectId = `project-${crypto.randomUUID()}`;

      assertEquals(await concurrency.acquireProjectSlot(projectId), true);
      const queued = concurrency.acquireProjectSlot(projectId, {
        wait: true,
        timeoutMs: 500,
      });
      assertEquals(
        await concurrency.acquireProjectSlot(projectId, {
          wait: true,
          timeoutMs: 500,
        }),
        false,
      );

      await concurrency.releaseProjectSlot(projectId);
      assertEquals(await queued, true);
      await concurrency.releaseProjectSlot(projectId);
    } finally {
      if (previousLimit === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_LIMIT", previousLimit);
      }
      if (previousQueueSize === undefined) {
        Deno.env.delete("RENDER_PER_PROJECT_QUEUE_SIZE");
      } else {
        Deno.env.set("RENDER_PER_PROJECT_QUEUE_SIZE", previousQueueSize);
      }
    }
  });

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
