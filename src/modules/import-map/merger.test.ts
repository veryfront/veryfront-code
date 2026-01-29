import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });
});
