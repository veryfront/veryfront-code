import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadImportMap } from "./loader.ts";

describe("modules/import-map/loader", () => {
  describe("loadImportMap", () => {
    it("should return an import map with imports", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/nonexistent-project", adapter);

      assertEquals(typeof result, "object");
      assertExists(result.imports);
    });

    it("should always include React mappings", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      assert("react" in imports, "should include react mapping");
      assert("react-dom" in imports, "should include react-dom mapping");
    });

    it("should include veryfront framework mappings", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      assert("veryfront/head" in imports, "should have veryfront/head");
      assert("veryfront/router" in imports, "should have veryfront/router");
      assert("veryfront/context" in imports, "should have veryfront/context");
    });

    it("should not include npm: specifiers in output", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      for (const [key, value] of Object.entries(imports ?? {})) {
        assert(
          !value.startsWith("npm:"),
          `Import "${key}" should not use npm: specifier, got: ${value}`,
        );
      }
    });

    it("should return consistent results for same path", async () => {
      const adapter = createMockAdapter();
      const result1 = await loadImportMap("/project-a", adapter);
      const result2 = await loadImportMap("/project-a", adapter);

      assertEquals(
        Object.keys(result1.imports ?? {}).length,
        Object.keys(result2.imports ?? {}).length,
      );
    });

    it("should handle deno.json without imports or scopes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/loader-test-project/deno.json",
        JSON.stringify({ compilerOptions: {} }),
      );

      const { imports } = await loadImportMap("/loader-test-project", adapter);

      assertExists(imports);
      assert("react" in imports, "should include default react");
    });

    it("should handle malformed deno.json gracefully", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/loader-bad-json/deno.json", "not valid json{");

      const { imports } = await loadImportMap("/loader-bad-json", adapter);

      assertExists(imports);
      assert("react" in imports, "should include default react");
    });

    it("should use esm.sh URLs for React", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assertExists(imports);
      const reactUrl = imports["react"];
      assertExists(reactUrl);
      assert(
        reactUrl.includes("esm.sh") || reactUrl.startsWith("file://"),
        `Expected esm.sh or file:// URL for react, got: ${reactUrl}`,
      );
    });

    it("should include react jsx-runtime mapping", async () => {
      const adapter = createMockAdapter();
      const { imports } = await loadImportMap("/any-project", adapter);

      assert(
        "react/jsx-runtime" in (imports ?? {}),
        "should include react/jsx-runtime mapping",
      );
    });

    it("should filter out relative paths from deno.json imports", async () => {
      // Relative paths like ./src/foo are for Deno native resolution,
      // not for browser/SSR module loading via /_vf_modules/
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-relative/deno.json",
        JSON.stringify({
          imports: {
            "veryfront/router": "./src/react/router/index.tsx",
            "my-lib": "../external/lib.ts",
            "valid-lib": "https://esm.sh/valid-lib",
          },
        }),
      );

      const { imports } = await loadImportMap("/project-with-relative", adapter);

      assertExists(imports);
      // Default import map has veryfront/router, should not be overwritten by relative path
      assert("veryfront/router" in imports, "should have veryfront/router");
      const routerPath = imports["veryfront/router"];
      assert(
        routerPath?.startsWith("/_vf_modules/"),
        `veryfront/router should use /_vf_modules/, got: ${routerPath}`,
      );
      // Relative path imports should be filtered out
      assert(!("my-lib" in imports), "relative ../external path should be filtered");
      // Non-relative paths should be kept
      assert("valid-lib" in imports, "https:// path should be kept");
    });

    it("should filter out relative paths from deno.json scopes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-scoped-relative/deno.json",
        JSON.stringify({
          scopes: {
            "/app/": {
              "relative": "./local/module.ts",
              "absolute": "https://esm.sh/some-lib",
            },
          },
        }),
      );

      const { scopes } = await loadImportMap("/project-with-scoped-relative", adapter);

      assertExists(scopes);
      const appScope = scopes["/app/"];
      assertExists(appScope);
      assert(!("relative" in appScope), "relative path in scope should be filtered");
      assert("absolute" in appScope, "absolute path in scope should be kept");
    });
  });
});
