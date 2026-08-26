import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isPathContainedBy } from "#veryfront/platform/adapters/path-containment.ts";

describe("isPathContainedBy", () => {
  it("rejects parent traversal after String.prototype.startsWith is replaced", () => {
    const originalStartsWith = Object.getOwnPropertyDescriptor(
      String.prototype,
      "startsWith",
    );
    Object.defineProperty(String.prototype, "startsWith", {
      configurable: true,
      value: () => false,
    });

    try {
      assertEquals(isPathContainedBy("/outside/secret.ts", "/project"), false);
      assertEquals(isPathContainedBy("/project/app/page.tsx", "/project"), true);
    } finally {
      Object.defineProperty(String.prototype, "startsWith", originalStartsWith!);
    }
  });
});
