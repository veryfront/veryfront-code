import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { createTokenConfig } from "./types.ts";

const baseConfig = {
  type: "veryfront-api" as const,
  veryfront: {
    apiToken: "test-token",
    projectSlug: "test-project",
  },
};

describe("createTokenConfig retry boundaries", () => {
  it("applies the shared Veryfront API retry defaults", () => {
    assertEquals(createTokenConfig(baseConfig).retry, {
      maxRetries: 3,
      initialDelay: 1_000,
      maxDelay: 10_000,
    });
  });

  it("rejects invalid retry policy at the exported factory boundary", () => {
    for (
      const retry of [
        { maxRetries: 10 },
        { initialDelay: 0.5 },
        { initialDelay: 2, maxDelay: 1 },
      ]
    ) {
      assertThrows(
        () =>
          createTokenConfig({
            ...baseConfig,
            veryfront: { ...baseConfig.veryfront, retry },
          }),
        RangeError,
      );
    }
  });

  it("accepts nine retries as the maximum boundary", () => {
    assertEquals(
      createTokenConfig({
        ...baseConfig,
        veryfront: {
          ...baseConfig.veryfront,
          retry: {
            maxRetries: MAX_VERYFRONT_API_RETRIES,
            initialDelay: 0,
            maxDelay: 0,
          },
        },
      }).retry,
      {
        maxRetries: MAX_VERYFRONT_API_RETRIES,
        initialDelay: 0,
        maxDelay: 0,
      },
    );
  });
});
