import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
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

    it("uses the validated hosted config without reloading executable project config", async () => {
      const adapter = createMockAdapter();
      const readPaths: string[] = [];
      let existsCalls = 0;
      let executableConfigReads = 0;
      const config = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: {
              "hosted-package": "https://config.example/hosted-package.ts",
            },
          },
        },
      });

      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          existsCalls += 1;
          return true;
        },
        readFile: async (path: string) => {
          readPaths.push(path);
          if (path === "deno.json") {
            return JSON.stringify({
              imports: {
                "hosted-package": "https://deno.example/hosted-package.ts",
              },
            });
          }

          executableConfigReads += 1;
          return 'export default { resolve: { importMap: { imports: { "hosted-package": "https://host.example/hosted-package.ts" } } } };';
        },
      });

      const { imports } = await loadImportMap("/hosted-project", adapter, config);

      assertEquals(
        imports?.["hosted-package"],
        "https://config.example/hosted-package.ts",
      );
      assertEquals(readPaths, ["deno.json"]);
      assertEquals(existsCalls, 0);
      assertEquals(executableConfigReads, 0);
    });

    it("keeps parsing and normalization deterministic after primordial poisoning", async () => {
      const adapter = createMockAdapter();
      const denoJson = JSON.stringify({
        imports: {
          "deno-only": "npm:deno-only@1",
          relative: "./local.ts",
          shared: "npm:deno-shared@1",
        },
        scopes: {
          "/app/": {
            relative: "../local.ts",
            scoped: "npm:scoped-package@3?dev=true",
          },
        },
      });
      const config = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: {
              shared: "npm:config-shared@2?dev=true",
            },
          },
        },
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        readFile: async (path: string) => {
          if (path !== "deno.json") throw new Error(`Unexpected path: ${path}`);
          return denoJson;
        },
      });
      const original = {
        arrayFilter: Array.prototype.filter,
        arrayIsArray: Array.isArray,
        arrayMap: Array.prototype.map,
        jsonParse: JSON.parse,
        objectAssign: Object.assign,
        objectCreate: Object.create,
        objectEntries: Object.entries,
        objectFromEntries: Object.fromEntries,
        stringSlice: String.prototype.slice,
        stringSplit: String.prototype.split,
        stringStartsWith: String.prototype.startsWith,
      };
      const poisoned = () => {
        throw new Error("poisoned primordial");
      };
      let result: Awaited<ReturnType<typeof loadImportMap>> | undefined;

      try {
        Reflect.set(Array, "isArray", poisoned);
        Reflect.set(Array.prototype, "filter", poisoned);
        Reflect.set(Array.prototype, "map", poisoned);
        Reflect.set(JSON, "parse", poisoned);
        Reflect.set(Object, "assign", poisoned);
        Reflect.set(Object, "create", poisoned);
        Reflect.set(Object, "entries", poisoned);
        Reflect.set(Object, "fromEntries", poisoned);
        Reflect.set(String.prototype, "slice", poisoned);
        Reflect.set(String.prototype, "split", poisoned);
        Reflect.set(String.prototype, "startsWith", poisoned);

        result = await loadImportMap("/hosted-project", adapter, config);
      } finally {
        Reflect.set(Array, "isArray", original.arrayIsArray);
        Reflect.set(Array.prototype, "filter", original.arrayFilter);
        Reflect.set(Array.prototype, "map", original.arrayMap);
        Reflect.set(JSON, "parse", original.jsonParse);
        Reflect.set(Object, "assign", original.objectAssign);
        Reflect.set(Object, "create", original.objectCreate);
        Reflect.set(Object, "entries", original.objectEntries);
        Reflect.set(Object, "fromEntries", original.objectFromEntries);
        Reflect.set(String.prototype, "slice", original.stringSlice);
        Reflect.set(String.prototype, "split", original.stringSplit);
        Reflect.set(String.prototype, "startsWith", original.stringStartsWith);
      }

      assertEquals(
        result?.imports?.shared,
        "https://esm.sh/config-shared@2?dev=true",
      );
      assertEquals(
        result?.imports?.["deno-only"],
        "https://esm.sh/deno-only@1?target=es2022",
      );
      assertEquals(result?.imports?.relative, undefined);
      assertEquals(
        result?.scopes?.["/app/"]?.scoped,
        "https://esm.sh/scoped-package@3?dev=true",
      );
      assertEquals(result?.scopes?.["/app/"]?.relative, undefined);
      assertExists(result?.imports?.react);
    });

    it("does not swallow the hosted invariant when validated config is omitted", async () => {
      const adapter = createMockAdapter();
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
      });

      await assertRejects(
        () => loadImportMap("/hosted-project-without-config", adapter),
        Error,
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

    it("rejects malformed deno.json instead of silently changing resolution", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/loader-bad-json/deno.json", "not valid json{");

      await assertRejects(
        () => loadImportMap("/loader-bad-json", adapter),
        SyntaxError,
      );
    });

    it("rejects invalid deno.json import-map shapes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/loader-invalid-map/deno.json",
        JSON.stringify({ imports: { package: 42 } }),
      );

      await assertRejects(
        () => loadImportMap("/loader-invalid-map", adapter),
        TypeError,
        "deno.json.imports.package must be a string",
      );
    });

    it("preserves __proto__ as an import specifier and scope name", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/loader-proto-map/deno.json",
        '{"imports":{"__proto__":"npm:proto-package@1"},"scopes":{"__proto__":{"__proto__":"npm:scoped-proto@2"}}}',
      );

      const result = await loadImportMap("/loader-proto-map", adapter);

      assertEquals(
        result.imports?.["__proto__"],
        "https://esm.sh/proto-package@1?target=es2022",
      );
      assertEquals(
        result.scopes?.["__proto__"]?.["__proto__"],
        "https://esm.sh/scoped-proto@2?target=es2022",
      );
    });

    it("propagates deno.json read failures other than not-found", async () => {
      const adapter = createMockAdapter();
      adapter.fs.readFile = () => Promise.reject(new Error("permission denied"));

      await assertRejects(
        () => loadImportMap("/loader-read-failure", adapter),
        Error,
        "permission denied",
      );
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
  });
});
