import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";

describe("flags", () => {
  describe("isRSCEnabled", () => {
    it("returns false when experimentalRsc is false", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("returns true when experimentalRsc is true", () => {
      const env = createTestEnvironmentConfig({ experimentalRsc: true });
      assertEquals(isRSCEnabled(undefined, env), true);
    });

    it("config.experimental.rsc takes precedence over env", () => {
      assertEquals(
        isRSCEnabled(
          { experimental: { rsc: false } },
          createTestEnvironmentConfig({ experimentalRsc: true }),
        ),
        false,
      );

      assertEquals(
        isRSCEnabled(
          { experimental: { rsc: true } },
          createTestEnvironmentConfig({ experimentalRsc: false }),
        ),
        true,
      );
    });

    it("falls back to env when config is not provided", () => {
      assertEquals(
        isRSCEnabled({}, createTestEnvironmentConfig({ experimentalRsc: true })),
        true,
      );

      assertEquals(
        isRSCEnabled({}, createTestEnvironmentConfig({ experimentalRsc: false })),
        false,
      );
    });
  });
});
