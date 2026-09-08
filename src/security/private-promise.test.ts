import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chainPrivatePromise, resolvePrivatePromise } from "./private-promise.ts";

describe("owned promise chains", () => {
  it("propagates input and callback failures while allowing explicit recovery", async () => {
    const failure = new Error("Synthetic lifecycle failure");
    await assertRejects(
      () => chainPrivatePromise(Promise.reject(failure), () => 1),
      Error,
      "Synthetic lifecycle failure",
    );
    await assertRejects(
      () => chainPrivatePromise(resolvePrivatePromise(), () => Promise.reject(failure)),
      Error,
      "Synthetic lifecycle failure",
    );
    assertEquals(await chainPrivatePromise(Promise.reject(failure), () => 1, () => 2), 2);
  });

  for (const phase of ["input", "callback"] as const) {
    it(`joins a frozen ${phase} promise without changing it`, async () => {
      const work = Promise.withResolvers<number>();
      Object.freeze(work.promise);
      const result = phase === "input"
        ? chainPrivatePromise(work.promise, (value) => value + 1)
        : chainPrivatePromise(resolvePrivatePromise(), () => work.promise);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(settled, false);
      } finally {
        work.resolve(41);
      }
      assertEquals(await result, phase === "input" ? 42 : 41);
      assertEquals(Object.getOwnPropertyNames(work.promise), []);
      assertEquals(Object.isFrozen(work.promise), true);
    });
  }

  for (const phase of ["input", "callback", "callback with copied constructor"] as const) {
    it(`joins the original ${phase} promise despite its own constructor and then hooks`, async () => {
      const work = Promise.withResolvers<number>();
      let hooks = 0;
      Object.defineProperties(work.promise, {
        constructor: {
          value: phase === "callback with copied constructor"
            ? resolvePrivatePromise().constructor
            : function ForeignConstructor() {},
          configurable: true,
        },
        then: {
          value: (fulfilled: (value: number) => void) => {
            hooks++;
            fulfilled(-1);
          },
          configurable: true,
        },
      });
      const originalProperties = Object.getOwnPropertyDescriptors(work.promise);
      const result = phase === "input"
        ? chainPrivatePromise(work.promise, (value) => value + 1)
        : chainPrivatePromise(resolvePrivatePromise(), () => work.promise);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(settled, false);
        assertEquals(hooks, 0);
      } finally {
        work.resolve(41);
      }
      assertEquals(await result, phase === "input" ? 42 : 41);
      assertEquals(Object.getOwnPropertyDescriptors(work.promise), originalProperties);
    });
  }
});
