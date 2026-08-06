import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __setCompiledBinaryForTests,
  ISOLATED_API_PREPARATION_UNSUPPORTED_REASON,
  isIsolatedApiPreparationSupported,
} from "./isolation-capability.ts";

afterEach(() => {
  __setCompiledBinaryForTests(undefined);
});

describe("isolation capability", () => {
  it("reports preparation supported when not running a compiled binary", () => {
    assertEquals(isIsolatedApiPreparationSupported(false), true);
  });

  it("reports preparation unsupported in a compiled binary", () => {
    assertEquals(isIsolatedApiPreparationSupported(true), false);
  });

  it("honours the test override in place of runtime detection", () => {
    __setCompiledBinaryForTests(true);
    assertEquals(isIsolatedApiPreparationSupported(), false);

    __setCompiledBinaryForTests(false);
    assertEquals(isIsolatedApiPreparationSupported(), true);
  });

  it("restores runtime detection when the override is cleared", () => {
    __setCompiledBinaryForTests(true);
    __setCompiledBinaryForTests(undefined);

    // `deno test` never runs from a compiled binary.
    assertEquals(isIsolatedApiPreparationSupported(), true);
  });

  it("states the real blocker, which is module linkage rather than transpilation", () => {
    // The reason is user-facing and is asserted on by the loader, the handler
    // and the compiled-binary e2e suite. It must keep naming the linkage, so a
    // future reader does not re-derive the false "no transpiler" premise that
    // sent the original investigation down a dead end.
    assert(ISOLATED_API_PREPARATION_UNSUPPORTED_REASON.includes("_vf_"));
    assert(ISOLATED_API_PREPARATION_UNSUPPORTED_REASON.includes("data:"));
  });
});
