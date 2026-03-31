import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Config Command", () => {
  it("getEnvironmentConfig returns required fields", async () => {
    const { getEnvironmentConfig } = await import("veryfront/config");
    const config = getEnvironmentConfig();
    assertEquals(typeof config.nodeEnv, "string");
    assertEquals(typeof config.apiBaseUrl, "string");
    assertEquals(typeof config.debug, "boolean");
  });
});
