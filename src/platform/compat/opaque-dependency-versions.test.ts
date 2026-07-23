import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OPAQUE_DEPENDENCY_VERSIONS } from "./opaque-dependency-versions.ts";

describe("platform/compat/opaque-dependency-versions", () => {
  it("keeps runtime import specifiers immutable", () => {
    assertEquals(Object.isFrozen(OPAQUE_DEPENDENCY_VERSIONS), true);

    try {
      (OPAQUE_DEPENDENCY_VERSIONS as Record<string, string>)[
        "@huggingface/transformers"
      ] = "0.0.0";
    } catch {
      // Frozen records can throw in strict mode.
    }

    assertEquals(OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"], "4.2.0");
  });
});
