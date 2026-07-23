import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeImportMaps } from "./merger.ts";

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

    it("treats prototype-looking specifiers as ordinary own properties", () => {
      const imports = JSON.parse('{"__proto__":"https://example.com/module.js"}');
      const result = mergeImportMaps({ imports });

      assertEquals(result.imports?.["__proto__"], "https://example.com/module.js");
      assertEquals(Object.getPrototypeOf(result.imports), Object.prototype);
    });

    it("rejects malformed runtime values", () => {
      assertThrows(
        () => mergeImportMaps({ imports: { broken: 42 } } as never),
        TypeError,
        "Invalid import map",
      );
    });

    it("bounds empty scope collections", () => {
      const scopes = Object.fromEntries(
        Array.from({ length: 5_001 }, (_, index) => [`/scope-${index}/`, {}]),
      );

      assertThrows(
        () => mergeImportMaps({ scopes }),
        TypeError,
        "Invalid import map",
      );
    });

    it("bounds the combined output across multiple maps", () => {
      const first = {
        imports: Object.fromEntries(
          Array.from({ length: 2_501 }, (_, index) => [
            `first-${index}`,
            `/first/${index}.js`,
          ]),
        ),
      };
      const second = {
        imports: Object.fromEntries(
          Array.from({ length: 2_501 }, (_, index) => [
            `second-${index}`,
            `/second/${index}.js`,
          ]),
        ),
      };

      assertThrows(
        () => mergeImportMaps(first, second),
        TypeError,
        "Merged import map exceeds entry limit",
      );
    });
  });
});
