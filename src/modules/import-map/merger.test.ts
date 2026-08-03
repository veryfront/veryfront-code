import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeImportMaps } from "./merger.ts";
import type { ImportMapConfig } from "./types.ts";

describe("modules/import-map/merger", () => {
  describe("mergeImportMaps", () => {
    it("should merge imports from multiple maps", () => {
      const result = mergeImportMaps(
        { imports: { react: "https://esm.sh/react@18" } },
        { imports: { lodash: "https://esm.sh/lodash" } },
      );

      assertEquals(result.imports?.react, "https://esm.sh/react@18");
      assertEquals(result.imports?.lodash, "https://esm.sh/lodash");
    });

    it("should override earlier imports with later ones", () => {
      const result = mergeImportMaps(
        { imports: { react: "https://esm.sh/react@17" } },
        { imports: { react: "https://esm.sh/react@18" } },
      );

      assertEquals(result.imports?.react, "https://esm.sh/react@18");
    });

    it("should merge scopes", () => {
      const result = mergeImportMaps(
        { imports: {}, scopes: { "/app/": { lodash: "v1" } } },
        { imports: {}, scopes: { "/app/": { react: "v2" } } },
      );

      assertEquals(result.scopes?.["/app/"]?.lodash, "v1");
      assertEquals(result.scopes?.["/app/"]?.react, "v2");
    });

    it("should handle empty maps", () => {
      const result = mergeImportMaps({ imports: {} }, { imports: {} });
      assertEquals(Object.keys(result.imports ?? {}).length, 0);
    });

    it("should handle maps without scopes", () => {
      const result = mergeImportMaps(
        { imports: { a: "b" } },
        { imports: { c: "d" } },
      );

      assertEquals(Object.keys(result.scopes ?? {}).length, 0);
    });

    it("should handle single map", () => {
      const result = mergeImportMaps({ imports: { a: "b" } });
      assertEquals(result.imports?.a, "b");
    });

    it("should preserve compatibility with enumerable metadata fields", () => {
      const map = {
        imports: { a: "b" },
        metadata: { source: "project" },
      } as { imports: Record<string, string>; metadata: { source: string } };

      const result = mergeImportMaps(map);

      assertEquals(result.imports?.a, "b");
    });

    it("rejects accessors after inherited descriptor poisoning without iterating keys", () => {
      const originalArrayIterator = Array.prototype[Symbol.iterator];
      const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let getterCalls = 0;
      let accessorError: unknown;
      const accessorMap = Object.defineProperty({}, "imports", {
        enumerable: true,
        get() {
          getterCalls++;
          return { accessed: "https://example.com/accessed.ts" };
        },
      }) as ImportMapConfig;

      try {
        Reflect.set(Array.prototype, Symbol.iterator, function (this: unknown[]) {
          if (this.length === 2 && this[0] === "imports" && this[1] === "scopes") {
            return { next: () => ({ done: true, value: undefined }) };
          }
          return Reflect.apply(originalArrayIterator, this, []);
        });
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: { poisoned: "https://example.com/poisoned.ts" },
        });

        try {
          mergeImportMaps(accessorMap);
        } catch (error) {
          accessorError = error;
        }
        const merged = mergeImportMaps({ imports: { safe: "https://example.com/safe.ts" } });
        assertEquals(merged.imports?.safe, "https://example.com/safe.ts");
      } finally {
        Reflect.set(Array.prototype, Symbol.iterator, originalArrayIterator);
        if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
        else Reflect.deleteProperty(Object.prototype, "value");
      }

      assertEquals(accessorError instanceof TypeError, true);
      assertEquals(getterCalls, 0);
    });
  });
});
