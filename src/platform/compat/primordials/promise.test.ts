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
