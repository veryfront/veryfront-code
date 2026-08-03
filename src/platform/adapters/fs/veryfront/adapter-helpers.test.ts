import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_FILESYSTEM_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
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

  it("rejects retry counts that exceed the filesystem request budget", () => {
    assertThrows(
      () =>
        buildRetryConfig({
          maxRetries: MAX_VERYFRONT_FILESYSTEM_RETRIES + 1,
        }),
      RangeError,
      "maxRetries",
    );
  });

  it("rejects invalid retry delays at direct adapter construction", () => {
    for (
      const retry of [
        { initialDelay: -1 },
        { initialDelay: 0.5 },
        { maxDelay: MAX_TIMER_DELAY_MS + 1 },
        { initialDelay: 2, maxDelay: 1 },
      ]
    ) {
      assertThrows(() => buildRetryConfig(retry), RangeError);
    }
    assertEquals(buildRetryConfig({ initialDelay: 0, maxDelay: 0 }), {
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelay: 0,
      maxDelay: 0,
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
    assertEquals(buildFileCacheOptions({ enabled: false, ttl: 5000 }), {
      enabled: false,
      ttl: 5000,
      maxSize: DEFAULT_CACHE_MAX_ENTRIES,
      maxMemory: DEFAULT_CACHE_MAX_MEMORY_BYTES,
    });
  });

  it("only background-pregenerates styles outside branch mode", () => {
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "branch" }), false);
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "environment" }), true);
    assertEquals(shouldBackgroundPregenerateStyles({ sourceType: "release" }), true);
    assertEquals(shouldBackgroundPregenerateStyles(null), true);
  });
});
