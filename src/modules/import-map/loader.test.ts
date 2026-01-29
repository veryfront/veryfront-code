import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loadImportMap } from "./loader.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

describe("modules/import-map/loader", () => {
  describe("loadImportMap", () => {
    it("should return an import map with imports", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/nonexistent-project", adapter);

      assertEquals(typeof result, "object");
      assert(result.imports !== undefined, "should have imports");
    });

    it("should always include React mappings", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/any-project", adapter);

      assertExists(result.imports);
      assert("react" in result.imports, "should include react mapping");
      assert("react-dom" in result.imports, "should include react-dom mapping");
    });

    it("should include veryfront framework mappings", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/any-project", adapter);

      const imports = result.imports;
      assertExists(imports);
      assert("veryfront/head" in imports, "should have veryfront/head");
      assert("veryfront/router" in imports, "should have veryfront/router");
      assert("veryfront/context" in imports, "should have veryfront/context");
    });

    it("should not include npm: specifiers in output", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/any-project", adapter);

      for (const [key, value] of Object.entries(result.imports ?? {})) {
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

      const result = await loadImportMap("/loader-test-project", adapter);

      assert(result.imports !== undefined, "should have imports");
      assertExists(result.imports);
      assert("react" in result.imports, "should include default react");
    });

    it("should handle malformed deno.json gracefully", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/loader-bad-json/deno.json", "not valid json{");

      const result = await loadImportMap("/loader-bad-json", adapter);

      assert(result.imports !== undefined, "should have imports");
      assertExists(result.imports);
      assert("react" in result.imports, "should include default react");
    });

    it("should use esm.sh URLs for React", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/any-project", adapter);

      assertExists(result.imports);
      const reactUrl = result.imports["react"];
      assertExists(reactUrl);
      assert(
        reactUrl.includes("esm.sh") || reactUrl.startsWith("file://"),
        `Expected esm.sh or file:// URL for react, got: ${reactUrl}`,
      );
    });

    it("should include react jsx-runtime mapping", async () => {
      const adapter = createMockAdapter();
      const result = await loadImportMap("/any-project", adapter);

      assert(
        "react/jsx-runtime" in (result.imports ?? {}),
        "should include react/jsx-runtime mapping",
      );
    });
  });
});
