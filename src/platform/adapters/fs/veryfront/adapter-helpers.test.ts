import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
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

  it("maps the legacy retryDelay option to initialDelay", () => {
    assertEquals(buildRetryConfig({ retryDelay: 250 }), {
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelay: 250,
      maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
    });
  });

  it("prefers initialDelay over the deprecated retryDelay option", () => {
    assertEquals(buildRetryConfig({ initialDelay: 125, retryDelay: 250 }), {
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelay: 125,
      maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
    });
  });

  it("snapshots and freezes retry configuration", () => {
    const retry = { maxRetries: 2, initialDelay: 25, maxDelay: 500 };
    const result = buildRetryConfig(retry);

    retry.maxRetries = 9;
    retry.initialDelay = 900;
    retry.maxDelay = 900;

    assertEquals(result, { maxRetries: 2, initialDelay: 25, maxDelay: 500 });
    assertEquals(Object.isFrozen(result), true);
  });

  it("reads only supported retry properties", () => {
    const retry = { maxRetries: 1, initialDelay: 0, maxDelay: 0 };
    Object.defineProperty(retry, "privateMetadata", {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_RETRY_METADATA/project-214");
      },
    });

    assertEquals(buildRetryConfig(retry), {
      maxRetries: 1,
      initialDelay: 0,
      maxDelay: 0,
    });
  });

  it("reads each supported retry property once", () => {
    const reads = new Map<string, number>();
    const retry = Object.create(null);
    for (
      const [property, value] of [
        ["maxRetries", 1],
        ["initialDelay", 10],
        ["maxDelay", 100],
        ["retryDelay", undefined],
      ] as const
    ) {
      Object.defineProperty(retry, property, {
        enumerable: true,
        get() {
          reads.set(property, (reads.get(property) ?? 0) + 1);
          return value;
        },
      });
    }

    const result = buildRetryConfig(retry);
    assertEquals(result, { maxRetries: 1, initialDelay: 10, maxDelay: 100 });
    assertEquals(Object.fromEntries(reads), {
      maxRetries: 1,
      initialDelay: 1,
      maxDelay: 1,
      retryDelay: 1,
    });
  });

  it("rejects unreadable retry configuration with a sanitized typed error", () => {
    const secret = "PRIVATE_RETRY_CONFIG/project-873";
    const retry = Object.create(null);
    Object.defineProperty(retry, "maxRetries", {
      get() {
        throw new Error(secret);
      },
    });

    let thrown: unknown;
    try {
      buildRetryConfig(retry);
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown instanceof VeryfrontError, true);
    assertEquals((thrown as VeryfrontError).slug, "config-invalid");
    assertEquals(JSON.stringify(thrown).includes(secret), false);
  });

  it("rejects invalid retry values at the filesystem boundary", () => {
    for (
      const retry of [
        { maxRetries: -1 },
        { maxRetries: 21 },
        { maxRetries: null },
        { initialDelay: -1 },
        { initialDelay: Number.NaN },
        { initialDelay: null },
        { maxDelay: Number.POSITIVE_INFINITY },
        { maxDelay: 2_147_483_648 },
        { maxDelay: null },
      ]
    ) {
      assertThrows(
        () => buildRetryConfig(retry as never),
        VeryfrontError,
      );
    }
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
