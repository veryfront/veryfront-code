import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isRSCEnabled } from "./feature-flags.ts";

describe("feature-flags", () => {
  describe("isRSCEnabled", () => {
    it("should return true when config.experimental.rsc is true", () => {
      assertEquals(isRSCEnabled({ experimental: { rsc: true } }), true);
    });

    it("should return false when config.experimental.rsc is false", () => {
      assertEquals(isRSCEnabled({ experimental: { rsc: false } }), false);
    });

    it("should return true when env experimentalRsc is true", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: true });
      assertEquals(isRSCEnabled(undefined, env), true);
    });

    it("should return false when env is not set and no config", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("should return false when experimentalRsc is false in env", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("should prefer config over env when config is provided", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: true });
      assertEquals(isRSCEnabled({ experimental: { rsc: false } }, env), false);
    });

    it("should fall back to env when config.experimental is missing", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: true });
      assertEquals(isRSCEnabled({}, env), true);
    });

    it("should fall back to env when config.experimental.rsc is undefined", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: true });
      assertEquals(isRSCEnabled({ experimental: {} }, env), true);
    });
  });
});
