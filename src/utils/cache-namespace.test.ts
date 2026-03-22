import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCacheNamespace } from "./cache-namespace.ts";

describe("utils/cache-namespace", () => {
  it("is stable for equivalent objects with different key order", () => {
    const left = createCacheNamespace("demo", {
      digest: "sha256-16hex",
      samples: ["alpha", "beta"],
      nested: { a: true, b: false },
    });
    const right = createCacheNamespace("demo", {
      nested: { b: false, a: true },
      samples: ["alpha", "beta"],
      digest: "sha256-16hex",
    });

    assertEquals(left, right);
  });

  it("changes when the schema changes", () => {
    const left = createCacheNamespace("demo", { sample: "alpha" });
    const right = createCacheNamespace("demo", { sample: "beta" });

    assertEquals(left === right, false);
  });
});
