import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Singleflight } from "./singleflight.ts";

describe("Singleflight", () => {
  it("should execute operation and return result", async () => {
    const sf = new Singleflight<number>();
    const result = await sf.do("key", () => Promise.resolve(42));
    assertEquals(result, 42);
  });

  it("should deduplicate concurrent calls with same key", async () => {
    const sf = new Singleflight<number>();
    let callCount = 0;

    const operation = () => {
      callCount++;
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 50));
    };

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

    const operation = (val: string) => {
      callCount++;
      return Promise.resolve(val);
    };

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
    let resolveOp!: (v: number) => void;

    const promise = sf.do("key", () =>
      new Promise<number>((r) => {
        resolveOp = r;
      }));

    assertEquals(sf.has("key"), true);
    assertEquals(sf.size, 1);

    resolveOp(1);
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
});
