import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRuntimeProviderStreamFailure,
  readRuntimeProviderStreamFailureCause,
} from "#veryfront/runtime/provider-stream-error-provenance.ts";

describe("provider stream error provenance", () => {
  it("uses captured WeakMap operations after prototype mutation", () => {
    const originalGet = WeakMap.prototype.get;
    const originalHas = WeakMap.prototype.has;
    const originalSet = WeakMap.prototype.set;
    WeakMap.prototype.get = function () {
      throw new Error("unexpected WeakMap.prototype.get call");
    };
    WeakMap.prototype.has = function () {
      throw new Error("unexpected WeakMap.prototype.has call");
    };
    WeakMap.prototype.set = function () {
      throw new Error("unexpected WeakMap.prototype.set call");
    };
    try {
      const cause = new Error("provider failed");
      const failure = createRuntimeProviderStreamFailure(cause);
      const provenance = readRuntimeProviderStreamFailureCause(failure);

      assertEquals(provenance.found, true);
      if (provenance.found) assertStrictEquals(provenance.cause, cause);
      assertStrictEquals(createRuntimeProviderStreamFailure(failure), failure);
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.has = originalHas;
      WeakMap.prototype.set = originalSet;
    }
  });
});
