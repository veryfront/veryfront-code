import "#veryfront/schemas/_test-setup.ts";
import { INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

    await Promise.all(
      Array.from({ length: 4 }, () => sem.acquire(operation)),
    );

    assertEquals(maxConcurrent, 2);
  });

  it("should release permit after operation throws", async () => {
    const sem = new Semaphore(1);

    await assertRejects(
      () => sem.acquire(() => Promise.reject(new Error("fail"))),
      Error,
      "fail",
    );

    const result = await sem.acquire(() => Promise.resolve("ok"));
    assertEquals(result, "ok");
  });

  it("should track active count", async () => {
    const sem = new Semaphore(3);
    assertEquals(sem.active, 0);

    let resolveOp: (() => void) | undefined;
    const promise = sem.acquire(
      () =>
        new Promise<void>((r) => {
          resolveOp = r;
        }),
    );

    await new Promise((r) => setTimeout(r, 0));
    assertEquals(sem.active, 1);

    resolveOp?.();
    await promise;
    assertEquals(sem.active, 0);
  });

  it("should track waiting count", async () => {
    const sem = new Semaphore(1);
    let resolveFirst: (() => void) | undefined;

    const first = sem.acquire(
      () =>
        new Promise<void>((r) => {
          resolveFirst = r;
        }),
    );

    const second = sem.acquire(() => Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(sem.waitingCount, 1);

    resolveFirst?.();
    await first;
    await second;
    assertEquals(sem.waitingCount, 0);
  });

  it("bounds the waiting queue and preserves FIFO order", async () => {
    const sem = new Semaphore(1, { maxQueueSize: 2 });
    let releaseBlocking: (() => void) | undefined;
    const order: number[] = [];
    const blocking = sem.acquire(
      () =>
        new Promise<void>((resolve) => {
          releaseBlocking = resolve;
        }),
    );
    const first = sem.acquire(() => {
      order.push(1);
      return Promise.resolve();
    });
    const second = sem.acquire(() => {
      order.push(2);
      return Promise.resolve();
    });
    const overflow = sem.acquire(() => {
      order.push(3);
      return Promise.resolve();
    });
    const overflowOutcome = overflow.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );

    try {
      const outcome = await Promise.race([
        overflowOutcome,
        new Promise<{ status: "pending" }>((resolve) =>
          setTimeout(() => resolve({ status: "pending" }), 0)
        ),
      ]);

      assertEquals(outcome.status, "rejected");
      assert("error" in outcome);
      assert(outcome.error instanceof VeryfrontError);
      assertEquals(outcome.error.slug, SERVICE_OVERLOADED.slug);
      assertEquals(sem.waitingCount, 2);
    } finally {
      releaseBlocking?.();
      await Promise.allSettled([blocking, first, second, overflow]);
    }

    assertEquals(order, [1, 2]);
    assertEquals(sem.waitingCount, 0);
  });

  it("bounds the waiting queue by default", async () => {
    const sem = new Semaphore(1);
    let releaseBlocking: (() => void) | undefined;
    const blocking = sem.acquire(
      () =>
        new Promise<void>((resolve) => {
          releaseBlocking = resolve;
        }),
    );
    const admitted = Array.from(
      { length: 1_024 },
      () => sem.acquire(() => Promise.resolve()),
    );
    const overflow = sem.acquire(() => Promise.resolve());
    const overflowOutcome = overflow.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );

    try {
      const outcome = await Promise.race([
        overflowOutcome,
        new Promise<{ status: "pending" }>((resolve) =>
          setTimeout(() => resolve({ status: "pending" }), 0)
        ),
      ]);

      assertEquals(outcome.status, "rejected");
      assertEquals(sem.waitingCount, 1_024);
    } finally {
      releaseBlocking?.();
      await Promise.allSettled([blocking, ...admitted, overflow]);
    }
  });

  it("should timeout if acquireTimeoutMs is set and exceeded", async () => {
    const sem = new Semaphore(1, { acquireTimeoutMs: 50, name: "test-sem" });

    let resolveBlock: (() => void) | undefined;
    const blocking = sem.acquire(
      () =>
        new Promise<void>((r) => {
          resolveBlock = r;
        }),
    );

    await assertRejects(
      () => sem.acquire(() => Promise.resolve()),
      SemaphoreTimeoutError,
    );

    resolveBlock?.();
    await blocking;
  });

  it("rejects invalid permit counts", () => {
    for (const permits of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new Semaphore(permits),
        Error,
        "positive safe integer",
      );
    }
  });

  it("rejects invalid acquire timeouts", () => {
    for (
      const acquireTimeoutMs of [-1, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY]
    ) {
      assertThrows(
        () => new Semaphore(1, { acquireTimeoutMs }),
        Error,
        "non-negative safe integer",
      );
    }
  });

  it("rejects invalid waiting queue limits", () => {
    for (const maxQueueSize of [-1, 1.5, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new Semaphore(1, { maxQueueSize }),
        Error,
        "non-negative safe integer",
      );
    }
  });

  it("sanitizes unreadable options", () => {
    const privateValue = "private-semaphore-option";
    const options = Object.defineProperty({}, "acquireTimeoutMs", {
      get() {
        throw new Error(privateValue);
      },
    });

    assertThrows(
      () => new Semaphore(1, options),
      Error,
      "Semaphore options are not readable",
    );
  });

  it("does not expose the semaphore name in timeout error serialization", () => {
    const privateName = "private-project-semaphore";
    const error = new SemaphoreTimeoutError(privateName, 50);

    assert(!error.message.includes(privateName));
    assert(!JSON.stringify(error).includes(privateName));
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

  it("rejects conflicting configurations for an existing name", () => {
    getSemaphore("configuration-conflict-test", 2, {
      acquireTimeoutMs: 10,
      maxQueueSize: 5,
    });

    assertThrows(
      () =>
        getSemaphore("configuration-conflict-test", 3, {
          acquireTimeoutMs: 10,
          maxQueueSize: 5,
        }),
      Error,
      "already configured",
    );
    assertThrows(
      () =>
        getSemaphore("configuration-conflict-test", 2, {
          acquireTimeoutMs: 20,
          maxQueueSize: 5,
        }),
      Error,
      "already configured",
    );
    assertThrows(
      () =>
        getSemaphore("configuration-conflict-test", 2, {
          acquireTimeoutMs: 10,
          maxQueueSize: 6,
        }),
      Error,
      "already configured",
    );
  });

  it("sanitizes typed errors thrown by unreadable registry options", () => {
    const privateValue = "private-registry-option";
    const options = Object.defineProperty({}, "acquireTimeoutMs", {
      get() {
        throw INVALID_ARGUMENT.create({ message: privateValue });
      },
    });

    assertThrows(
      () => getSemaphore("unreadable-registry-options", 1, options),
      Error,
      "Semaphore options are not readable",
    );
  });

  it("rejects new names at the registry cap without replacing existing instances", async () => {
    const isolated = await import("./semaphore.ts?registry-cap-test");
    const first = isolated.getSemaphore("bounded-registry-stable", 1);
    let capacityError: unknown;
    for (let index = 0; index <= 1_010; index++) {
      try {
        isolated.getSemaphore(`bounded-registry-${index}`, 1);
      } catch (error) {
        capacityError = error;
        break;
      }
    }

    assert(capacityError instanceof Error);
    assert(capacityError.message.includes("registry capacity"));
    assert(isolated.getSemaphore("bounded-registry-stable", 1) === first);
  });
});
