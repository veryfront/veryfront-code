import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "../../../src/platform/compat/runtime.ts";

// These cases mutate host globals and belong to the process-effect integration suite.
describe("native NotFound bootstrap capture", () => {
  for (
    const mutation of [
      "namespace accessor",
      "namespace proxy",
      "version accessor",
      "build accessor",
    ]
  ) {
    it(`does not invoke a ${mutation} on late classifier import`, async () => {
      if (!isDeno) return;
      const nativeDeno = Deno;
      const missing = new nativeDeno.errors.NotFound("synthetic missing file");
      const owner = mutation.startsWith("namespace") ? globalThis : nativeDeno;
      const key = mutation.startsWith("namespace")
        ? "Deno"
        : mutation === "version accessor"
        ? "version"
        : "build";
      const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
      let hooks = 0;
      const fail = () => {
        hooks++;
        throw new Error("project hook invoked");
      };
      try {
        Object.defineProperty(
          owner,
          key,
          mutation === "namespace proxy"
            ? {
              configurable: true,
              value: new Proxy(nativeDeno, {
                get: fail,
                getOwnPropertyDescriptor: fail,
                getPrototypeOf: fail,
              }),
            }
            : { configurable: true, get: fail },
        );
        const classifier = await import(
          `../../../src/platform/compat/not-found-error.ts?bootstrap-${
            encodeURIComponent(mutation)
          }`
        );
        assertEquals(classifier.isCanonicalNotFoundError(missing), true);
        assertEquals(
          classifier.isCanonicalNotFoundError(new Error("wrapped", { cause: missing })),
          true,
        );
        assertEquals(classifier.isCanonicalNotFoundError({ code: "ENOENT" }), false);
        assertEquals(hooks, 0);
      } finally {
        Object.defineProperty(owner, key, descriptor);
      }
    });
  }
});
