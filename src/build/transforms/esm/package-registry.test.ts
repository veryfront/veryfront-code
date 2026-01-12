import { assertEquals, assert } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { getTailwindImportMap } from "./package-registry.ts";

describe("package-registry", () => {
  describe("getTailwindImportMap", () => {
    it("should return valid import map entries", () => {
      const map = getTailwindImportMap();
      assert(Object.keys(map).length > 0);
    });

    it("should not use prefix mappings (they cause issues with query params)", () => {
      // Prefix mappings (keys ending in /) don't work with query params per import map spec.
      // Use explicit subpath mappings instead.
      const map = getTailwindImportMap();
      for (const key of Object.keys(map)) {
        assert(
          !key.endsWith("/"),
          `Found prefix mapping "${key}" - use explicit subpath mappings instead`
        );
      }
    });

    it("all entries should include ?target=es2022", () => {
      const map = getTailwindImportMap();
      for (const [key, address] of Object.entries(map)) {
        assert(
          address.includes("?target=es2022"),
          `Entry "${key}" missing ?target=es2022: ${address}`
        );
      }
    });

    it("should map tailwindcss bare specifier", () => {
      const map = getTailwindImportMap();
      assert("tailwindcss" in map);
      assert(map.tailwindcss.includes("esm.sh"));
    });

    it("should map common tailwindcss subpaths", () => {
      const map = getTailwindImportMap();
      assertEquals(typeof map["tailwindcss/plugin"], "string");
      assertEquals(typeof map["tailwindcss/colors"], "string");
      assertEquals(typeof map["tailwindcss/defaultTheme"], "string");
    });
  });
});
