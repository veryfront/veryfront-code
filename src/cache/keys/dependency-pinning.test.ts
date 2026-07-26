import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildDependencyPinningCacheVariant } from "./dependency-pinning.ts";

describe("dependency pinning cache variant", () => {
  it("keeps distinct module server origins isolated when their short hashes collide", () => {
    const first = buildDependencyPinningCacheVariant(
      "on:snapshot",
      "https://ylo7e9sj2loj.example.test",
    );
    const second = buildDependencyPinningCacheVariant(
      "on:snapshot",
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
    assertEquals(buildDependencyPinningCacheVariant("on:snapshot"), "on:snapshot");
  });
});
