import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
    const serialized = '{"z":2,"ä":1}';

    assertEquals(
      createCacheNamespace("demo", { ä: 1, z: 2 }),
      `demo-${fnv1aHash(serialized).padStart(8, "0")}`,
    );
  });

  it("distinguishes supported arrays and rejects sparse or accessor entries", () => {
    const sparse = new Array(1);
    assertThrows(
      () => createCacheNamespace("demo", sparse as never),
      TypeError,
      "sparse",
    );

    let getterCalls = 0;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, 0, {
      enumerable: true,
      get() {
        getterCalls++;
        return "nondeterministic";
      },
    });
    assertThrows(
      () => createCacheNamespace("demo", accessor as never),
      TypeError,
      "data properties",
    );

    const objectAccessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls++;
        return "nondeterministic";
      },
    });
    assertThrows(
      () => createCacheNamespace("demo", objectAccessor as never),
      TypeError,
      "data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("pads the 32-bit digest and rejects unsupported hash lengths", () => {
    assertEquals(createCacheNamespace("demo", { value: 50 }), "demo-0d650d3b");
    for (const length of [9, 10, Number.MAX_SAFE_INTEGER]) {
      assertThrows(
        () => createCacheNamespace("demo", { value: true }, length),
        RangeError,
      );
    }
  });

  it("rejects values that cannot be represented without collisions", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertThrows(
        () => createCacheNamespace("demo", { value }),
        RangeError,
      );
    }
  });

  it("rejects cyclic schemas and invalid hash lengths explicitly", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    assertThrows(
      () => createCacheNamespace("demo", cyclic as never),
      TypeError,
      "cyclic",
    );
    for (const length of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => createCacheNamespace("demo", { value: true }, length),
        RangeError,
      );
    }
  });
});
