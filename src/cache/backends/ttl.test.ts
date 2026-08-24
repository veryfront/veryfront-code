import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheTtlMillisecondsToSeconds,
  expiresImmediately,
  MAX_CACHE_TTL_MILLISECONDS,
  MAX_CACHE_TTL_SECONDS,
  requirePositiveIntegerCacheTtlSeconds,
  resolveCacheTtlSeconds,
  resolveIntegerCacheTtlSeconds,
} from "./ttl.ts";

describe("cache TTL contract", () => {
  it("preserves precise TTLs and defaults only when omitted", () => {
    assertEquals(resolveCacheTtlSeconds(undefined), undefined);
    assertEquals(resolveCacheTtlSeconds(undefined, 300), 300);
    assertEquals(resolveCacheTtlSeconds(0, 300), 0);
    assertEquals(resolveCacheTtlSeconds(0.1), 0.1);
    assertEquals(resolveCacheTtlSeconds(-0.1), -0.1);
  });

  it("rounds positive fractions up for integer-second protocols", () => {
    assertEquals(resolveIntegerCacheTtlSeconds(undefined, 300), 300);
    assertEquals(resolveIntegerCacheTtlSeconds(0.1), 1);
    assertEquals(resolveIntegerCacheTtlSeconds(1.01), 2);
    assertEquals(resolveIntegerCacheTtlSeconds(0), 0);
    assertEquals(resolveIntegerCacheTtlSeconds(-0.1), -0.1);
  });

  it("classifies zero and negative values as immediate expiry", () => {
    assertEquals(expiresImmediately(0), true);
    assertEquals(expiresImmediately(-1), true);
    assertEquals(expiresImmediately(0.1), false);
    assertEquals(expiresImmediately(undefined), false);
  });

  it("rejects non-finite values before a backend can persist them", () => {
    for (
      const ttl of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        MAX_CACHE_TTL_SECONDS + 1,
        Number.MAX_VALUE,
      ]
    ) {
      assertThrows(
        () => resolveCacheTtlSeconds(ttl),
        RangeError,
        "finite number of seconds at most",
      );
      assertThrows(() => resolveIntegerCacheTtlSeconds(ttl), RangeError);
    }
  });

  it("accepts the advertised maximum TTL", () => {
    assertEquals(
      resolveCacheTtlSeconds(MAX_CACHE_TTL_SECONDS),
      MAX_CACHE_TTL_SECONDS,
      "the advertised maximum TTL must be accepted",
    );
    assertEquals(
      resolveIntegerCacheTtlSeconds(MAX_CACHE_TTL_SECONDS),
      MAX_CACHE_TTL_SECONDS,
      "the advertised maximum must survive integer-second resolution",
    );
    assertEquals(
      requirePositiveIntegerCacheTtlSeconds(MAX_CACHE_TTL_SECONDS),
      MAX_CACHE_TTL_SECONDS,
      "the advertised maximum is a valid constructor TTL",
    );
  });

  it("converts positive millisecond TTLs without shortening them", () => {
    assertEquals(cacheTtlMillisecondsToSeconds(1), 1);
    assertEquals(cacheTtlMillisecondsToSeconds(1_000), 1);
    assertEquals(cacheTtlMillisecondsToSeconds(1_001), 2);
    assertEquals(
      cacheTtlMillisecondsToSeconds(MAX_CACHE_TTL_MILLISECONDS),
      MAX_CACHE_TTL_SECONDS,
    );
  });

  it("rejects millisecond TTLs outside the safe integer-second range", () => {
    for (
      const ttl of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_CACHE_TTL_MILLISECONDS + 1,
      ]
    ) {
      assertThrows(() => cacheTtlMillisecondsToSeconds(ttl), RangeError);
    }
  });

  it("advertised maximum produces an exact safe expiry timestamp", () => {
    const now = Date.now();
    const expiresAt = now + MAX_CACHE_TTL_MILLISECONDS;
    assertEquals(Number.isSafeInteger(expiresAt), true);
    assertEquals(Number.isFinite(expiresAt), true);
    assertEquals(expiresAt - now, MAX_CACHE_TTL_MILLISECONDS);
    assertEquals(Number.isNaN(new Date(expiresAt).getTime()), false);
  });
});
