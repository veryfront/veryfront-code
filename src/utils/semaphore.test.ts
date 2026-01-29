import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSemaphore, Semaphore, SemaphoreTimeoutError } from "./semaphore.ts";

describe("Semaphore", () => {
  it("should execute operation and return result", async () => {
    const sem = new Semaphore(2);
    const result = await sem.acquire(() => Promise.resolve(42));
    assertEquals(result, 42);
  });

  it("should limit concurrency to maxPermits", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const operation = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return concurrent;
    };

    await Promise.all([
      sem.acquire(operation),
      sem.acquire(operation),
      sem.acquire(operation),
      sem.acquire(operation),
    ]);

    assertEquals(maxConcurrent, 2);
  });

  it("should release permit after operation throws", async () => {
    const sem = new Semaphore(1);

    await assertRejects(
      () => sem.acquire(() => Promise.reject(new Error("fail"))),
      Error,
      "fail",
    );

    // Should be able to acquire again
    const result = await sem.acquire(() => Promise.resolve("ok"));
    assertEquals(result, "ok");
  });

  it("should track active count", async () => {
    const sem = new Semaphore(3);
    assertEquals(sem.active, 0);

    let resolveOp!: () => void;
    const promise = sem.acquire(() =>
      new Promise<void>((r) => {
        resolveOp = r;
      })
    );

    // Give microtask a tick
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(sem.active, 1);

    resolveOp();
    await promise;
    assertEquals(sem.active, 0);
  });

  it("should track waiting count", async () => {
    const sem = new Semaphore(1);
    let resolveFirst!: () => void;

    const first = sem.acquire(() =>
      new Promise<void>((r) => {
        resolveFirst = r;
      })
    );

    // Start a second acquire that will wait
    const second = sem.acquire(() => Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(sem.waitingCount, 1);

    resolveFirst();
    await first;
    await second;
    assertEquals(sem.waitingCount, 0);
  });

  it("should timeout if acquireTimeoutMs is set and exceeded", async () => {
    const sem = new Semaphore(1, { acquireTimeoutMs: 50, name: "test-sem" });

    // Fill the semaphore
    let resolveBlock!: () => void;
    const blocking = sem.acquire(() =>
      new Promise<void>((r) => {
        resolveBlock = r;
      })
    );

    await assertRejects(
      () => sem.acquire(() => Promise.resolve()),
      SemaphoreTimeoutError,
    );

    resolveBlock();
    await blocking;
  });
});

describe("getSemaphore", () => {
  it("should return same instance for same name", () => {
    const s1 = getSemaphore("shared-test", 5);
    const s2 = getSemaphore("shared-test", 5);
    assertEquals(s1, s2);
  });

  it("should return different instances for different names", () => {
    const s1 = getSemaphore("name-a", 5);
    const s2 = getSemaphore("name-b", 5);
    assertEquals(s1 !== s2, true);
  });
});
