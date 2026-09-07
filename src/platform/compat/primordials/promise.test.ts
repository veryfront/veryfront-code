import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  primordialPromiseAll,
  primordialPromiseFinally,
  primordialPromiseReject,
  primordialPromiseResolve,
  primordialPromiseThen,
} from "./promise.ts";

describe("platform/compat/primordials/promise", () => {
  it("rejects before an unfinished sibling and observes later sibling rejection", async () => {
    const sibling = Promise.withResolvers<number>();
    const failure = new Error("first failure");
    try {
      await assertRejects(
        () => primordialPromiseAll([sibling.promise, primordialPromiseReject(failure)]),
        Error,
        "first failure",
      );
    } finally {
      sibling.reject(new Error("later sibling failure"));
    }
    assertEquals(await primordialPromiseAll([]), []);
  });

  it("tracks the synchronously observed input length without hanging or resolving early", async () => {
    const shortened = [primordialPromiseResolve(1), primordialPromiseResolve(2)];
    Object.defineProperty(shortened, 0, {
      configurable: true,
      get() {
        shortened.length = 1;
        return primordialPromiseResolve(1);
      },
    });
    assertEquals(await primordialPromiseAll(shortened), [1]);

    const delayed = Promise.withResolvers<number>();
    const extended: Promise<number>[] = [primordialPromiseResolve(3)];
    Object.defineProperty(extended, 0, {
      configurable: true,
      get() {
        Object.defineProperty(extended, 1, {
          configurable: true,
          enumerable: true,
          value: delayed.promise,
          writable: true,
        });
        return primordialPromiseResolve(3);
      },
    });
    const pending = primordialPromiseAll(extended);
    let settled = false;
    primordialPromiseThen(pending, () => {
      settled = true;
    });
    await primordialPromiseResolve();
    assertEquals(settled, false);
    delayed.resolve(4);
    assertEquals(await pending, [3, 4]);
    assertEquals(await primordialPromiseAll(new Array(1)), [undefined]);
  });

  it("rejects a throwing indexed getter without observing later inputs", async () => {
    const first = Promise.withResolvers<number>();
    const failure = new Error("indexed getter failure");
    const values: Promise<number>[] = [];
    values.length = 3;
    Object.defineProperty(values, 0, {
      configurable: true,
      enumerable: true,
      value: first.promise,
      writable: true,
    });
    Object.defineProperty(values, 1, {
      configurable: true,
      get() {
        throw failure;
      },
    });
    let laterObserved = false;
    Object.defineProperty(values, 2, {
      configurable: true,
      get() {
        laterObserved = true;
        return primordialPromiseResolve(3);
      },
    });
    await assertRejects(() => primordialPromiseAll(values), Error, failure.message);
    assertEquals(laterObserved, false);
    first.reject(new Error("already observed input rejected later"));
    await primordialPromiseResolve();
  });

  it("does not send fulfillment callback failures to the same rejection handler", async () => {
    let recovered = false;
    await assertRejects(
      () =>
        primordialPromiseThen(primordialPromiseResolve(1), () => {
          throw new Error("callback failure");
        }, () => {
          recovered = true;
        }),
      Error,
      "callback failure",
    );
    assertEquals(recovered, false);
    await assertRejects(
      () =>
        primordialPromiseFinally(primordialPromiseResolve(1), () => {
          throw new Error("cleanup failure");
        }),
      Error,
      "cleanup failure",
    );
  });
});
