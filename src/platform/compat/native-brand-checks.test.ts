import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { snapshotNativeBrandChecks } from "./native-brand-checks.ts";

describe("native brand checks", () => {
  it("falls back to the captured Error.isError brand when the host check misses", () => {
    const checks = snapshotNativeBrandChecks({
      isAsyncFunction: () => false,
      isNativeError: () => false,
      isPromise: () => false,
      isProxy: () => false,
      isUint8Array: () => false,
    });

    assertEquals(checks?.isNativeError(new Error("native")), true);
    assertEquals(checks?.isNativeError({ name: "Error", message: "shaped" }), false);
  });
});
