import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";

describe("createDefaultInvalidationCallbacks", () => {
  it("keeps defaults when an explicit override is undefined", () => {
    const callbacks = createDefaultInvalidationCallbacks({
      clearSSRModuleCache: undefined,
      clearModulePathCache: undefined,
    });

    assertEquals(typeof callbacks.clearSSRModuleCache, "function");
    assertEquals(typeof callbacks.clearModulePathCache, "function");
  });

  it("snapshots supported callbacks once and freezes the result", () => {
    const first = () => {};
    const second = () => {};
    let reads = 0;
    const overrides = Object.create(null);
    Object.defineProperty(overrides, "triggerReload", {
      enumerable: true,
      get() {
        reads++;
        return reads === 1 ? first : second;
      },
    });

    const callbacks = createDefaultInvalidationCallbacks(overrides);

    assertEquals(reads, 1);
    assertStrictEquals(callbacks.triggerReload, first);
    assertEquals(Object.isFrozen(callbacks), true);
  });

  it("does not inspect unknown callback properties", () => {
    const overrides = Object.create(null);
    Object.defineProperty(overrides, "privateMetadata", {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_CALLBACK_METADATA/project-218");
      },
    });

    const callbacks = createDefaultInvalidationCallbacks(overrides);
    assertEquals(typeof callbacks.clearSSRModuleCache, "function");
  });

  it("rejects unreadable callbacks with a sanitized typed error", () => {
    const secret = "PRIVATE_INVALIDATION_CALLBACK/project-903";
    const callbacks = Object.create(null);
    Object.defineProperty(callbacks, "triggerReload", {
      get() {
        throw new Error(secret);
      },
    });

    let thrown: unknown;
    try {
      createDefaultInvalidationCallbacks(callbacks);
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown instanceof VeryfrontError, true);
    assertEquals((thrown as VeryfrontError).slug, "config-invalid");
    assertEquals(JSON.stringify(thrown).includes(secret), false);
  });

  it("is idempotent for an already normalized callback set", () => {
    const first = createDefaultInvalidationCallbacks({ triggerReload: () => {} });
    const second = createDefaultInvalidationCallbacks(first);

    assertStrictEquals(second, first);
  });

  it("handles detached default callback failures without an unhandled rejection", async () => {
    const failures: string[] = [];
    const callbacks = createDefaultInvalidationCallbacks(undefined, {
      loadModule: () => Promise.reject(new Error("PRIVATE_DYNAMIC_IMPORT/project-622")),
      reportFailure: (callback) => failures.push(callback),
    });

    const result = callbacks.clearSSRModuleCache?.();
    assertEquals(result, undefined);
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(failures, ["clearSSRModuleCache"]);
  });
});
