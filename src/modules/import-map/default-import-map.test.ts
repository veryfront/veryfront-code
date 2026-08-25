import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDefaultImportMap } from "./default-import-map.ts";

describe("modules/import-map/default-import-map", () => {
  describe("getDefaultImportMap", () => {
    function getImports(): Record<string, string> {
      const { imports } = getDefaultImportMap();
      assertExists(imports);
      return imports;
    }

    it("should return an object with imports", () => {
      const map = getDefaultImportMap();
      assert(map.imports !== undefined, "imports should be defined");
      assertEquals(typeof map.imports, "object");
    });

    it("should include React mappings", () => {
      const imports = getImports();

      assert("react" in imports, "should have 'react' mapping");
      assert("react-dom" in imports, "should have 'react-dom' mapping");
    });

    it("should include Veryfront framework mappings", () => {
      const imports = getImports();

      assert("veryfront/react" in imports, "should have 'veryfront/react' mapping");
      assert("veryfront/head" in imports, "should have 'veryfront/head' mapping");
      assert("veryfront/router" in imports, "should have 'veryfront/router' mapping");
      assert("veryfront/context" in imports, "should have 'veryfront/context' mapping");
      assert("veryfront/fonts" in imports, "should have 'veryfront/fonts' mapping");
      assert("veryfront/ui" in imports, "should have 'veryfront/ui' mapping");
    });

    it("maps every React-bearing deno.json export so the specifier resolves", () => {
      // veryfront/ui was exported from deno.json but named in no import map, so
      // a project importing it shipped a bare specifier the browser could not
      // resolve -- and the release build then counted the importing module as
      // uncovered, which is fatal to the whole manifest.
      const imports = getImports();

      assertEquals(
        Object.keys(imports).filter((key) => key.startsWith("veryfront/")).sort(),
        [
          "veryfront/chat",
          "veryfront/context",
          "veryfront/fonts",
          "veryfront/head",
          "veryfront/markdown",
          "veryfront/mdx",
          "veryfront/react",
          "veryfront/react/context",
          "veryfront/react/fonts",
          "veryfront/react/head",
          "veryfront/react/router",
          "veryfront/router",
          "veryfront/ui",
          "veryfront/workflow",
        ],
        "every React-bearing veryfront export must stay mapped",
      );
      assertEquals(
        imports["veryfront/ui"],
        "/_vf_modules/_veryfront/react/components/ui/index.js?ssr=true",
      );
    });

    it("should map veryfront/react to the browser public barrel", () => {
      const imports = getImports();

      assertEquals(
        imports["veryfront/react"],
        "/_vf_modules/_veryfront/react/public.js?ssr=true",
      );
    });

    it("should include veryfront/react/* alias mappings", () => {
      const imports = getImports();

      assert("veryfront/react/head" in imports, "should have 'veryfront/react/head'");
      assert("veryfront/react/router" in imports, "should have 'veryfront/react/router'");
      assert("veryfront/react/context" in imports, "should have 'veryfront/react/context'");
      assert("veryfront/react/fonts" in imports, "should have 'veryfront/react/fonts'");
    });

    it("should map veryfront aliases to module server URLs", () => {
      const imports = getImports();

      const coreReactUrl = "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true";
      assertEquals(
        imports["veryfront/head"],
        coreReactUrl,
        "veryfront/head must map to the React runtime core module",
      );
      assertEquals(
        imports["veryfront/router"],
        coreReactUrl,
        "veryfront/router must map to the React runtime core module",
      );
      assertEquals(
        imports["veryfront/context"],
        coreReactUrl,
        "veryfront/context must map to the React runtime core module",
      );
    });

    it("should map veryfront/head and veryfront/react/head to the same file", () => {
      const imports = getImports();

      assertEquals(imports["veryfront/head"], imports["veryfront/react/head"]);
      assertEquals(imports["veryfront/router"], imports["veryfront/react/router"]);
      assertEquals(imports["veryfront/context"], imports["veryfront/react/context"]);
      assertEquals(imports["veryfront/fonts"], imports["veryfront/react/fonts"]);
    });

    it("should map veryfront/workflow to React hooks submodule for SSR", () => {
      const imports = getImports();

      const workflowUrl = imports["veryfront/workflow"];
      assertExists(workflowUrl, "should have 'veryfront/workflow' mapping");
      assert(
        workflowUrl.includes("/_vf_modules/_veryfront/workflow/react/"),
        `Expected workflow to map to React hooks submodule, got: ${workflowUrl}`,
      );
      assert(workflowUrl.includes("?ssr=true"), `Expected ssr=true param but got: ${workflowUrl}`);
    });

    it("should not map veryfront/embedding to removed React upload hooks", () => {
      const imports = getImports();

      assertEquals(imports["veryfront/embedding"], undefined);
    });

    it("should map React to esm.sh URLs", () => {
      const imports = getImports();

      const reactUrl = imports["react"];
      assertExists(reactUrl);
      assert(
        reactUrl.includes("esm.sh") || reactUrl.startsWith("file://"),
        `Expected esm.sh or file URL for react, got: ${reactUrl}`,
      );
    });
  });
});
