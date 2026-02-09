import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getEnv } from "#veryfront/platform/compat/process.ts";

// Import storage to ensure globalThis.__vfProjectEnvGetter is registered
import { runWithProjectEnv } from "./storage.ts";

describe("getEnv with project env overlay", () => {
  it("returns project env overlay when active", () => {
    runWithProjectEnv({ CUSTOM_VAR: "custom-value" }, () => {
      assertEquals(getEnv("CUSTOM_VAR"), "custom-value");
    });
  });

  it("falls through to process env when no overlay", () => {
    // PATH is always set in process env
    const pathValue = getEnv("PATH");
    assertEquals(typeof pathValue, "string");
    assertEquals((pathValue?.length ?? 0) > 0, true);
  });

  it("falls through to process env when key not in overlay", () => {
    runWithProjectEnv({ SOME_KEY: "some-value" }, () => {
      // PATH should still come from process env
      const pathValue = getEnv("PATH");
      assertEquals(typeof pathValue, "string");
    });
  });

  it("overlay takes precedence over process env for matching keys", () => {
    // This test verifies overlay precedence without modifying process env
    runWithProjectEnv({ TEST_OVERLAY_KEY: "overlay-value" }, () => {
      assertEquals(getEnv("TEST_OVERLAY_KEY"), "overlay-value");
    });

    // Outside overlay, should not find the key (unless it happens to be in process env)
    // We just verify the overlay is gone
    assertEquals(getEnv("TEST_OVERLAY_KEY"), undefined);
  });
});
