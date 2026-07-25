import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  DEFAULT_VERYFRONT_API_RETRY_CONFIG,
  filesystemTotalAttempts,
  MAX_FILESYSTEM_TOTAL_ATTEMPTS,
  MAX_GITHUB_FILESYSTEM_ATTEMPTS,
  MAX_VERYFRONT_API_RETRIES,
  MAX_VERYFRONT_FILESYSTEM_RETRIES,
  normalizeFilesystemRetryConfig,
  normalizeVeryfrontApiRetryConfig,
  requireFilesystemRetryCount,
  requireVeryfrontApiRetryConfig,
} from "./config-resource-limits.ts";
import { MAX_TIMER_DELAY_MS } from "./timer.ts";

Deno.test("filesystem retry policy preserves each backend's count semantics", () => {
  assertEquals(filesystemTotalAttempts(0, "retries-after-initial"), 1);
  assertEquals(
    filesystemTotalAttempts(
      MAX_VERYFRONT_FILESYSTEM_RETRIES,
      "retries-after-initial",
    ),
    MAX_FILESYSTEM_TOTAL_ATTEMPTS,
  );
  assertEquals(filesystemTotalAttempts(0, "legacy-total-attempts"), 1);
  assertEquals(filesystemTotalAttempts(1, "legacy-total-attempts"), 1);
  assertEquals(filesystemTotalAttempts(2, "legacy-total-attempts"), 2);
  assertEquals(
    filesystemTotalAttempts(
      MAX_GITHUB_FILESYSTEM_ATTEMPTS,
      "legacy-total-attempts",
    ),
    MAX_FILESYSTEM_TOTAL_ATTEMPTS,
  );
});

Deno.test("filesystem retry policy rejects values outside its bounded integer domain", () => {
  for (const semantics of ["retries-after-initial", "legacy-total-attempts"] as const) {
    const maximum = semantics === "retries-after-initial"
      ? MAX_VERYFRONT_FILESYSTEM_RETRIES
      : MAX_GITHUB_FILESYSTEM_ATTEMPTS;
    for (
      const value of [
        -1,
        0.5,
        maximum + 1,
        Number.POSITIVE_INFINITY,
      ]
    ) {
      assertThrows(
        () => requireFilesystemRetryCount(value, semantics),
        RangeError,
        "maxRetries",
      );
    }
  }
});

Deno.test("filesystem retry normalization bounds delays and their relationship", () => {
  const defaults = {
    maxRetries: 3,
    initialDelay: 1_000,
    maxDelay: 10_000,
  };
  assertEquals(
    normalizeFilesystemRetryConfig(
      { maxRetries: 0, initialDelay: 0, maxDelay: MAX_TIMER_DELAY_MS },
      defaults,
      "retries-after-initial",
    ),
    {
      maxRetries: 0,
      initialDelay: 0,
      maxDelay: MAX_TIMER_DELAY_MS,
    },
  );

  for (
    const input of [
      { initialDelay: -1 },
      { initialDelay: 0.5 },
      { maxDelay: MAX_TIMER_DELAY_MS + 1 },
      { initialDelay: 1_000, maxDelay: 999 },
    ]
  ) {
    assertThrows(
      () =>
        normalizeFilesystemRetryConfig(
          input,
          defaults,
          "retries-after-initial",
        ),
      RangeError,
    );
  }
});

Deno.test("Veryfront API retry normalization applies defaults and accepts its maximum boundary", () => {
  assertEquals(
    normalizeVeryfrontApiRetryConfig(undefined),
    DEFAULT_VERYFRONT_API_RETRY_CONFIG,
  );
  assertEquals(
    requireVeryfrontApiRetryConfig({
      maxRetries: MAX_VERYFRONT_API_RETRIES,
      initialDelay: 0,
      maxDelay: MAX_TIMER_DELAY_MS,
    }),
    {
      maxRetries: MAX_VERYFRONT_API_RETRIES,
      initialDelay: 0,
      maxDelay: MAX_TIMER_DELAY_MS,
    },
  );
  assertEquals(
    MAX_VERYFRONT_API_RETRIES + 1,
    MAX_FILESYSTEM_TOTAL_ATTEMPTS,
  );
});

Deno.test("Veryfront API retry normalization rejects unsafe retry counts", () => {
  for (
    const maxRetries of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_VERYFRONT_API_RETRIES + 1,
      Number.MAX_SAFE_INTEGER,
    ]
  ) {
    assertThrows(
      () => normalizeVeryfrontApiRetryConfig({ maxRetries }),
      RangeError,
      "maxRetries",
    );
  }
});

Deno.test("Veryfront API retry normalization rejects unsafe delays", () => {
  for (const name of ["initialDelay", "maxDelay"] as const) {
    for (
      const value of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
        Number.MAX_SAFE_INTEGER,
      ]
    ) {
      assertThrows(
        () => normalizeVeryfrontApiRetryConfig({ [name]: value }),
        RangeError,
        name,
      );
    }
  }
});

Deno.test("Veryfront API retry normalization rejects an inverted delay range", () => {
  assertThrows(
    () =>
      normalizeVeryfrontApiRetryConfig({
        initialDelay: 1_001,
        maxDelay: 1_000,
      }),
    RangeError,
    "initialDelay must not exceed maxDelay",
  );
});
