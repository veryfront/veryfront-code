import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findPlatformViolationsInContent } from "./lint-platform-agnostic.ts";

describe("findPlatformViolationsInContent", () => {
  it("flags direct Deno DNS resolution outside platform compat", () => {
    const violations = findPlatformViolationsInContent(
      "src/security/sandbox/worker-egress-guard.ts",
      `const addresses = await Deno.resolveDns(hostname, "A");`,
    );

    assertEquals(violations.map((violation) => violation.pattern), ["Deno.resolveDns()"]);
  });
});
