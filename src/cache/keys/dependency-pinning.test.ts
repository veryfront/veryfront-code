import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildDependencyPinnedRenderCacheKey,
  buildDependencyPinningCacheVariant,
} from "./dependency-pinning.ts";

const CANONICAL_PIN_KEY = "on:z7bg3qnfgtcb";

describe("dependency pinning cache variant", () => {
  it("keeps distinct module server origins isolated when their short hashes collide", () => {
    const first = buildDependencyPinningCacheVariant(
      CANONICAL_PIN_KEY,
      "https://ylo7e9sj2loj.example.test",
    );
    const second = buildDependencyPinningCacheVariant(
      CANONICAL_PIN_KEY,
      "https://qtwvqx4b2t0r.example.test",
    );

    assertNotEquals(first, second);
  });

  it("preserves legacy identities when pinning or the origin is unset", () => {
    assertEquals(
      buildDependencyPinningCacheVariant(undefined, "https://preview.example.test"),
      undefined,
    );
    assertEquals(
      buildDependencyPinningCacheVariant("off", "https://preview.example.test"),
      undefined,
    );
    assertEquals(
      buildDependencyPinningCacheVariant(CANONICAL_PIN_KEY),
      CANONICAL_PIN_KEY,
    );
  });

  it("rejects malformed and reserved pin-on identities", () => {
    for (
      const cacheKey of [
        "",
        "on:",
        "on:no-project",
        "on:unknown",
        "on:01",
        "on:3w5e11264sgsg",
        "on:aaaaaaaaaaaaaa",
        `on:${"a".repeat(10_000)}`,
        "on:UPPERCASE",
        "on:pins-a",
        "on:pins/origin",
        " on:snapshot",
        "on:snapshot\n",
      ]
    ) {
      assertEquals(
        buildDependencyPinningCacheVariant(cacheKey, "https://preview.example.test"),
        undefined,
      );
    }
  });

  it("accepts the canonical uint64 boundaries", () => {
    assertEquals(buildDependencyPinningCacheVariant("on:0"), "on:0");
    assertEquals(
      buildDependencyPinningCacheVariant("on:3w5e11264sgsf"),
      "on:3w5e11264sgsf",
    );
  });

  it("keeps long origin variants bounded and safe for the API cache", () => {
    const snapshotKey = "on:3w5e11264sgsf";
    const first = buildDependencyPinningCacheVariant(
      snapshotKey,
      `https://${"a".repeat(10_000)}.example.test`,
    );
    const second = buildDependencyPinningCacheVariant(
      snapshotKey,
      `https://${"b".repeat(10_000)}.example.test`,
    );

    assert(first);
    assert(second);
    for (const variant of [first, second]) {
      assert(variant.length <= 512);
      assertMatch(variant, /^[a-zA-Z0-9_:.\-/]+$/);
    }
    assertNotEquals(first, second);
  });

  it("bounds the complete API render key without changing flag-off identity", () => {
    const legacyKey = "a".repeat(440);
    const options = {
      cachePrefix: "project:preview:branch:v1",
      addPagePrefix: true,
      colorScheme: "dark" as const,
    };
    const first = buildDependencyPinnedRenderCacheKey(
      legacyKey,
      CANONICAL_PIN_KEY,
      "https://preview.example.test",
      options,
    );
    const repeated = buildDependencyPinnedRenderCacheKey(
      legacyKey,
      CANONICAL_PIN_KEY,
      "https://preview.example.test",
      options,
    );
    const otherOrigin = buildDependencyPinnedRenderCacheKey(
      legacyKey,
      CANONICAL_PIN_KEY,
      "https://other.example.test",
      options,
    );
    const completeKey = `render:${options.cachePrefix}:page:${first}:theme-${options.colorScheme}`;

    assert(completeKey.length <= 512);
    assertMatch(completeKey, /^[a-zA-Z0-9_:.\-/]+$/);
    assertEquals(first, repeated);
    assertNotEquals(first, otherOrigin);
    assertEquals(
      buildDependencyPinnedRenderCacheKey(
        legacyKey,
        "off",
        "https://preview.example.test",
        options,
      ),
      legacyKey,
    );
  });

  it("keeps pin-on rendering available when a caller-owned prefix is API-invalid", () => {
    const composition = {
      cachePrefix: "project@local:preview:main:v1",
      addPagePrefix: true,
    };
    const key = buildDependencyPinnedRenderCacheKey(
      "index",
      "on:1",
      "https://preview.example.test",
      composition,
    );

    assertMatch(key, /^pins:hash-[0-9a-z]+-[0-9a-z]+$/);
    assertEquals(
      buildDependencyPinnedRenderCacheKey(
        "index",
        "off",
        "https://preview.example.test",
        composition,
      ),
      "index",
    );
  });

  it("preserves a terminal theme suffix at the exact composed API boundary", () => {
    const legacyKey = `${"a".repeat(479)}:theme-dark`;
    const key = buildDependencyPinnedRenderCacheKey(
      legacyKey,
      "on:1",
      undefined,
      { addPagePrefix: true, colorScheme: "dark" },
    );

    assertEquals(
      key,
      `${"a".repeat(479)}:pins:on:1:theme-dark`,
    );
    assertEquals(`render:page:${key}`.length, 512);
  });

  it("does not emit a readable key that aliases the sanitizer fallback namespace", () => {
    const key = buildDependencyPinnedRenderCacheKey(
      "page:vf-sanitized",
      "on:1",
    );

    assertMatch(key, /^page:pins:hash-[0-9a-z]+-[0-9a-z]+$/);
  });
});
