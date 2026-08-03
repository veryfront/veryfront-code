import "#veryfront/schemas/_test-setup.ts";
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

    it("probes a canonical deno.json path when the project path has a trailing slash", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/trailing-slash-project/deno.json",
        JSON.stringify({
          imports: { "project-package": "https://esm.sh/project-package@1" },
        }),
      );

      const { imports } = await loadImportMap("/trailing-slash-project/", adapter);

      assertEquals(imports?.["project-package"], "https://esm.sh/project-package@1");
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

    it("should keep veryfront framework mappings local when deno.json uses npm overrides", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project-with-npm-overrides/deno.json",
        JSON.stringify({
          imports: {
            "veryfront": "npm:veryfront@0.1.759",
            "veryfront/chat": "npm:veryfront@0.1.759/chat",
            "veryfront/router": "npm:veryfront@0.1.759/router",
            "react": "npm:react@19.1.1",
          },
        }),
      );

      const { imports } = await loadImportMap("/project-with-npm-overrides", adapter);

      assertExists(imports);
      assertEquals(
        imports["veryfront/chat"]?.startsWith("/_vf_modules/_veryfront/chat/"),
        true,
      );
      assertEquals(
        imports["veryfront/router"]?.startsWith("/_vf_modules/_veryfront/react/runtime/core.js"),
        true,
      );
      assertEquals(imports["veryfront/chat"]?.includes("esm.sh"), false);
      assertEquals(imports["veryfront/router"]?.includes("esm.sh"), false);
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

    it("uses captured JSON and collection primordials while loading deno.json maps", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/poisoned-deno-json/deno.json",
        JSON.stringify({
          imports: {
            "pkg": "https://esm.sh/pkg@1",
            "relative": "./local.ts",
          },
          scopes: {
            "/app/": {
              "scoped": "https://esm.sh/scoped@1",
            },
          },
        }),
      );
      const original = {
        jsonParse: JSON.parse,
        objectEntries: Object.entries,
        objectFromEntries: Object.fromEntries,
        arrayEvery: Array.prototype.every,
        arrayFilter: Array.prototype.filter,
        arrayJoin: Array.prototype.join,
        arrayMap: Array.prototype.map,
        arrayPush: Array.prototype.push,
        arraySome: Array.prototype.some,
      };

      try {
        JSON.parse = (() => {
          throw new Error("poisoned JSON.parse");
        }) as typeof JSON.parse;
        Object.entries = (() => {
          throw new Error("poisoned Object.entries");
        }) as typeof Object.entries;
        Object.fromEntries = (() => {
          throw new Error("poisoned Object.fromEntries");
        }) as typeof Object.fromEntries;
        Array.prototype.every = function () {
          throw new Error("poisoned Array.prototype.every");
        };
        Array.prototype.filter = function () {
          throw new Error("poisoned Array.prototype.filter");
        };
        Array.prototype.join = function () {
          throw new Error("poisoned Array.prototype.join");
        };
        Array.prototype.map = function () {
          throw new Error("poisoned Array.prototype.map");
        };
        Array.prototype.push = function () {
          throw new Error("poisoned Array.prototype.push");
        };
        Array.prototype.some = function () {
          throw new Error("poisoned Array.prototype.some");
        };

        const { imports, scopes } = await loadImportMap("/poisoned-deno-json", adapter);

        assertEquals(imports?.pkg, "https://esm.sh/pkg@1");
        assertEquals(imports?.relative, undefined);
        assertEquals(scopes?.["/app/"]?.scoped, "https://esm.sh/scoped@1");
      } finally {
        JSON.parse = original.jsonParse;
        Object.entries = original.objectEntries;
        Object.fromEntries = original.objectFromEntries;
        Array.prototype.every = original.arrayEvery;
        Array.prototype.filter = original.arrayFilter;
        Array.prototype.join = original.arrayJoin;
        Array.prototype.map = original.arrayMap;
        Array.prototype.push = original.arrayPush;
        Array.prototype.some = original.arraySome;
      }
    });
  });
});
