import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { Singleflight, waitForSharedPromise } from "./singleflight.ts";

describe("Singleflight", () => {
  it("lets one waiter detach without cancelling shared work", async () => {
    const controller = new AbortController();
    const shared = Promise.withResolvers<number>();
    const detached = waitForSharedPromise(shared.promise, controller.signal);
    const follower = waitForSharedPromise(shared.promise);

    controller.abort(new Error("caller stopped waiting"));
    await assertRejects(() => detached, Error, "caller stopped waiting");

    shared.resolve(42);
    assertEquals(await follower, 42);
  });

  it("should execute operation and return result", async () => {
    const sf = new Singleflight<number>();
    const result = await sf.do("key", () => Promise.resolve(42));
    assertEquals(result, 42);
  });

  it("should deduplicate concurrent calls with same key", async () => {
    const sf = new Singleflight<number>();
    let callCount = 0;

    function operation(): Promise<number> {
      callCount++;
      return new Promise((resolve) => setTimeout(() => resolve(42), 50));
    }

    const [r1, r2, r3] = await Promise.all([
      sf.do("key", operation),
      sf.do("key", operation),
      sf.do("key", operation),
    ]);

    assertEquals(r1, 42);
    assertEquals(r2, 42);
    assertEquals(r3, 42);
    assertEquals(callCount, 1);
  });

  it("should allow different keys to run concurrently", async () => {
    const sf = new Singleflight<string>();
    let callCount = 0;

    function operation(val: string): Promise<string> {
      callCount++;
      return Promise.resolve(val);
    }

    const [r1, r2] = await Promise.all([
      sf.do("a", () => operation("first")),
      sf.do("b", () => operation("second")),
    ]);

    assertEquals(r1, "first");
    assertEquals(r2, "second");
    assertEquals(callCount, 2);
  });

  it("should clean up after operation completes", async () => {
    const sf = new Singleflight<number>();

    await sf.do("key", () => Promise.resolve(1));

    assertEquals(sf.has("key"), false);
    assertEquals(sf.size, 0);
  });

  it("should clean up after operation fails", async () => {
    const sf = new Singleflight<number>();

    await assertRejects(
      () => sf.do("key", () => Promise.reject(new Error("fail"))),
      Error,
      "fail",
    );

    assertEquals(sf.has("key"), false);
    assertEquals(sf.size, 0);
  });

  it("should propagate errors to all waiters", async () => {
    const sf = new Singleflight<number>();
    const error = new Error("shared failure");

    const results = await Promise.allSettled([
      sf.do("key", () => Promise.reject(error)),
      sf.do("key", () => Promise.reject(error)),
    ]);

    assertEquals(results[0].status, "rejected");
    assertEquals(results[1].status, "rejected");
  });

  it("should report in-flight status via has()", async () => {
    const sf = new Singleflight<number>();
    let resolveOp: ((v: number) => void) | undefined;

    const promise = sf.do(
      "key",
      () =>
        new Promise<number>((resolve) => {
          resolveOp = resolve;
        }),
    );

    assertEquals(sf.has("key"), true);
    assertEquals(sf.size, 1);

    resolveOp?.(1);
    await promise;

    assertEquals(sf.has("key"), false);
    assertEquals(sf.size, 0);
  });

  it("should allow new operation after previous completes", async () => {
    const sf = new Singleflight<number>();

    const r1 = await sf.do("key", () => Promise.resolve(1));
    const r2 = await sf.do("key", () => Promise.resolve(2));

    assertEquals(r1, 1);
    assertEquals(r2, 2);
  });

  it("evicts only the exact leader that exceeds its stale window", async () => {
    using time = new FakeTime();
    const sf = new Singleflight<number>();
    let resolveStale!: (value: number) => void;
    let resolveReplacement!: (value: number) => void;
    let staleIsCurrent!: () => boolean;
    let replacementIsCurrent!: () => boolean;
    let staleEvictions = 0;

    const stale = sf.do(
      "key",
      (control) => {
        staleIsCurrent = control.isCurrent;
        return new Promise<number>((resolve) => resolveStale = resolve);
      },
      { staleAfterMs: 1_000, onStaleEvicted: () => staleEvictions++ },
    );

    await time.tickAsync(1_000);
    assertEquals(sf.has("key"), false);
    assertEquals(staleEvictions, 1);
    assertEquals(staleIsCurrent(), false);

    const replacement = sf.do(
      "key",
      (control) => {
        replacementIsCurrent = control.isCurrent;
        return new Promise<number>((resolve) => resolveReplacement = resolve);
      },
      { staleAfterMs: 1_000 },
    );
    resolveStale(1);
    assertEquals(await stale, 1);
    assertEquals(sf.has("key"), true);
    assertEquals(replacementIsCurrent(), true);

    resolveReplacement(2);
    assertEquals(await replacement, 2);
    assertEquals(sf.has("key"), false);
  });

  it("isolates errors thrown by stale-eviction observers", async () => {
    using time = new FakeTime();
    const sf = new Singleflight<number>();
    let resolveOperation!: (value: number) => void;

    const operation = sf.do(
      "key",
      () => new Promise<number>((resolve) => resolveOperation = resolve),
      {
        staleAfterMs: 1_000,
        onStaleEvicted: () => {
          throw new Error("observer failed");
        },
      },
    );

    await time.tickAsync(1_000);
    assertEquals(sf.has("key"), false);

    resolveOperation(1);
    assertEquals(await operation, 1);
  });
});
