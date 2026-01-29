import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDefaultImportMap } from "./default-import-map.ts";

describe("modules/import-map/default-import-map", () => {
  describe("getDefaultImportMap", () => {
    it("should return an object with imports", () => {
      const map = getDefaultImportMap();
      assert(map.imports !== undefined, "imports should be defined");
      assertEquals(typeof map.imports, "object");
    });

    it("should include React mappings", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      assert("react" in imports, "should have 'react' mapping");
      assert("react-dom" in imports, "should have 'react-dom' mapping");
    });

    it("should include Veryfront framework mappings", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      assert("veryfront/head" in imports, "should have 'veryfront/head' mapping");
      assert("veryfront/router" in imports, "should have 'veryfront/router' mapping");
      assert("veryfront/context" in imports, "should have 'veryfront/context' mapping");
      assert("veryfront/fonts" in imports, "should have 'veryfront/fonts' mapping");
    });

    it("should include veryfront/react/* alias mappings", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      assert("veryfront/react/head" in imports, "should have 'veryfront/react/head'");
      assert("veryfront/react/router" in imports, "should have 'veryfront/react/router'");
      assert("veryfront/react/context" in imports, "should have 'veryfront/react/context'");
      assert("veryfront/react/fonts" in imports, "should have 'veryfront/react/fonts'");
    });

    it("should map veryfront aliases to file:// URLs", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      const headUrl = imports["veryfront/head"];
      assert(headUrl.startsWith("file://"), `Expected file:// URL but got: ${headUrl}`);
    });

    it("should map veryfront/head and veryfront/react/head to the same file", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      assertEquals(imports["veryfront/head"], imports["veryfront/react/head"]);
      assertEquals(imports["veryfront/router"], imports["veryfront/react/router"]);
      assertEquals(imports["veryfront/context"], imports["veryfront/react/context"]);
      assertEquals(imports["veryfront/fonts"], imports["veryfront/react/fonts"]);
    });

    it("should map React to esm.sh URLs", () => {
      const map = getDefaultImportMap();
      const imports = map.imports!;

      const reactUrl = imports["react"];
      assert(
        reactUrl.includes("esm.sh") || reactUrl.startsWith("file://"),
        `Expected esm.sh or file URL for react, got: ${reactUrl}`,
      );
    });
  });
});
