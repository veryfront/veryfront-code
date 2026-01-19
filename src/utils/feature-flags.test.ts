import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createTestRuntimeEnv } from "@veryfront/config/runtime-env.ts";
import { isRSCEnabled } from "./feature-flags.ts";

describe("feature-flags", () => {
  describe("isRSCEnabled", () => {
    it("should return true when config.experimental.rsc is true", () => {
      const config = { experimental: { rsc: true } };
      assertEquals(isRSCEnabled(config), true);
    });

    it("should return false when config.experimental.rsc is false", () => {
      const config = { experimental: { rsc: false } };
      assertEquals(isRSCEnabled(config), false);
    });

    it("should return true when env experimentalRsc is true", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: true });
      assertEquals(isRSCEnabled(undefined, env), true);
    });

    it("should return false when env is not set and no config", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("should return false when experimentalRsc is false in env", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("should prefer config over env when config is provided", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: true });
      const config = { experimental: { rsc: false } };
      assertEquals(isRSCEnabled(config, env), false);
    });

    it("should fall back to env when config.experimental is missing", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: true });
      assertEquals(isRSCEnabled({}, env), true);
    });

    it("should fall back to env when config.experimental.rsc is undefined", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: true });
      const config = { experimental: {} };
      assertEquals(isRSCEnabled(config, env), true);
    });
  });
});
