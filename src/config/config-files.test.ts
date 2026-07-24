import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";

describe("config-files", () => {
  it("keeps the recognized config filename list immutable at runtime", () => {
    assertEquals(Object.isFrozen(VERYFRONT_CONFIG_FILES), true);
    assertEquals(VERYFRONT_CONFIG_FILES, [
      "veryfront.config.js",
      "veryfront.config.ts",
      "veryfront.config.mjs",
    ]);
  });
});
