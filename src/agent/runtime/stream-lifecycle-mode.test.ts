import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveStreamLifecycleMode } from "./stream-lifecycle-mode.ts";

describe("resolveStreamLifecycleMode", () => {
  it("accepts only known modes and falls back otherwise", () => {
    assertEquals(resolveStreamLifecycleMode(undefined, "legacy"), "legacy");
    assertEquals(resolveStreamLifecycleMode("shadow", "legacy"), "shadow");
    assertEquals(resolveStreamLifecycleMode("active", "legacy"), "active");
    assertEquals(resolveStreamLifecycleMode("invalid", "legacy"), "legacy");
  });
});
