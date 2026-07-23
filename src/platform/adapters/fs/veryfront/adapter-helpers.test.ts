import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildFileCacheOptions,
  buildRetryConfig,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_MEMORY_BYTES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_INITIAL_RETRY_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RETRY_DELAY_MS,
  shouldBackgroundPregenerateStyles,
} from "./adapter-helpers.ts";

describe("veryfront adapter helpers", () => {
  it("builds retry config with defaults", () => {
    assertEquals(buildRetryConfig(undefined), {
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelay: DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
    });
  });

  it("builds retry config with overrides", () => {
    assertEquals(buildRetryConfig({ maxRetries: 5, initialDelay: 200 }), {
      maxRetries: 5,
      initialDelay: 200,
      maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
    });
  });

  it("builds file cache options with defaults", () => {
    assertEquals(buildFileCacheOptions(undefined), {
      enabled: true,
      ttl: DEFAULT_CACHE_TTL_MS,
      maxSize: DEFAULT_CACHE_MAX_ENTRIES,
      maxMemory: DEFAULT_CACHE_MAX_MEMORY_BYTES,
    });
  });

  it("builds file cache options with overrides", () => {
    assertEquals(
      buildFileCacheOptions({ enabled: false, ttl: 5000, maxSize: 25, maxMemory: 4096 }),
      {
        enabled: false,
        ttl: 5000,
        maxSize: 25,
        maxMemory: 4096,
      },
    );
  });

  it("only background-pregenerates styles outside branch mode", () => {
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "branch" }), false);
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "environment" }), true);
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "release" }), true);
    assertEquals(shouldBackgroundPregenerateStyles(null), true);
  });
});
