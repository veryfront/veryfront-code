import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chainPrivatePromise } from "#veryfront/security/private-promise.ts";

describe("private promise lifecycle intrinsics", () => {
  it("awaits original inputs and callback results with replaced constructor and then methods", async () => {
    const input = Promise.withResolvers<void>();
    const output = Promise.withResolvers<string>();
    const originalConstructor = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor")!;
    const originalThen = Promise.prototype.then;
    const nativePromise = Promise;
    const originalResolve = Promise.resolve;
    let callbackEntered = false;
    let completed = false;
    let consumerCompleted = false;
    let chained: Promise<string> | undefined;
    let consumer: Promise<void> | undefined;
    // An own thenable supplies a test turn without relying on the replaced methods.
    const turn = {
      then(resolve: () => void) {
        setTimeout(resolve, 0);
      },
    };
    await turn;
    try {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        writable: true,
        value: function ProjectPromise() {},
      });
      Promise.prototype.then = (function (fulfilled: ((value: unknown) => unknown) | undefined) {
        fulfilled?.(undefined);
        return Reflect.apply(originalResolve, nativePromise, []);
      }) as typeof originalThen;
      chained = chainPrivatePromise(input.promise, () => {
        callbackEntered = true;
        return output.promise;
      });
      Reflect.apply(originalThen, chained, [() => {
        completed = true;
      }]);
      consumer = (async () => {
        await chained;
        consumerCompleted = true;
      })();
      await turn;
      assertEquals(callbackEntered, false);
      assertEquals(completed, false);
      assertEquals(consumerCompleted, false);
      input.resolve();
      await turn;
      assertEquals(callbackEntered, true);
      assertEquals(completed, false);
      assertEquals(consumerCompleted, false);
    } finally {
      Object.defineProperty(Promise.prototype, "constructor", originalConstructor);
      Promise.prototype.then = originalThen;
      input.resolve();
      output.resolve("finished");
      await chained;
      await consumer;
    }
    assertEquals(await chained, "finished");
    assertEquals(completed, true);
    assertEquals(consumerCompleted, true);
  });
});
