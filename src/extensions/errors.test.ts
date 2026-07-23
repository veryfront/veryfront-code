import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as canonicalErrors from "#veryfront/errors";
import * as extensionErrors from "./errors.ts";

describe("extension errors", () => {
  it("re-exports canonical registry definitions without duplicate identity", () => {
    for (
      const name of [
        "MISSING_EXTENSION_ERROR",
        "EXTENSION_VALIDATION_ERROR",
        "CIRCULAR_DEPENDENCY_ERROR",
        "EXTENSION_CONFLICT_ERROR",
        "EXTENSION_SETUP_TIMEOUT_ERROR",
      ] as const
    ) {
      assertStrictEquals(extensionErrors[name], canonicalErrors[name]);
    }
  });

  it("matches typed slugs without leaking hostile prototype failures", () => {
    const error = canonicalErrors.EXTENSION_VALIDATION_ERROR.create({ message: "invalid" });
    assertEquals(extensionErrors.isVeryfrontErrorWithSlug(error, "extension-validation"), true);
    assertEquals(extensionErrors.isVeryfrontErrorWithSlug(error, "missing-extension"), false);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertEquals(
      extensionErrors.isVeryfrontErrorWithSlug(revoked.proxy, "extension-validation"),
      false,
    );
  });
});
