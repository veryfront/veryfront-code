import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chainPrivatePromise, resolvePrivatePromise } from "./private-promise.ts";

describe("owned promise chains", () => {
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
    });
  }
});
