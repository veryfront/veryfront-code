import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCacheNamespace } from "./cache-namespace.ts";
import { fnv1aHash } from "./hash-utils.ts";

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

  it("sorts object keys by locale-independent code-unit order", () => {
    // Code-unit order puts "z" (0x7a) before "ä" (0xe4); localeCompare in most
    // locales would sort "ä" first and derive a different namespace per locale.
    const serialized = '{"z":2,"ä":1}';

    assertEquals(
      createCacheNamespace("demo", { ä: 1, z: 2 }),
      `demo-${fnv1aHash(serialized)}`,
    );
  });
});
