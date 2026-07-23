import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";

describe("config files", () => {
  it("exports an immutable precedence list", () => {
    assertEquals(Object.isFrozen(VERYFRONT_CONFIG_FILES), true);
    assertEquals(VERYFRONT_CONFIG_FILES, [
      "veryfront.config.js",
      "veryfront.config.ts",
      "veryfront.config.mjs",
    ]);
  });
});
