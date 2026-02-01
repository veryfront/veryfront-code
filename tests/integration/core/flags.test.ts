import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createTestRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";

describe("flags", () => {
  describe("isRSCEnabled", () => {
    it("returns false when experimentalRsc is false", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: false });
      assertEquals(isRSCEnabled(undefined, env), false);
    });

    it("returns true when experimentalRsc is true", () => {
      const env = createTestRuntimeEnv({ experimentalRsc: true });
      assertEquals(isRSCEnabled(undefined, env), true);
    });

    it("config.experimental.rsc takes precedence over env", () => {
      assertEquals(
        isRSCEnabled(
          { experimental: { rsc: false } },
          createTestRuntimeEnv({ experimentalRsc: true }),
        ),
        false,
      );

      assertEquals(
        isRSCEnabled(
          { experimental: { rsc: true } },
          createTestRuntimeEnv({ experimentalRsc: false }),
        ),
        true,
      );
    });

    it("falls back to env when config is not provided", () => {
      assertEquals(
        isRSCEnabled({}, createTestRuntimeEnv({ experimentalRsc: true })),
        true,
      );

      assertEquals(
        isRSCEnabled({}, createTestRuntimeEnv({ experimentalRsc: false })),
        false,
      );
    });
  });
});
