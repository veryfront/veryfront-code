import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import * as esbuild from "esbuild";
import type { OnResolveArgs, PluginBuild, ResolveResult } from "esbuild";

function createMockBuild(
  onResolve: PluginBuild["onResolve"],
  onLoad: PluginBuild["onLoad"],
): PluginBuild {
  const resolveResult: ResolveResult = {
    errors: [],
    warnings: [],
    path: "",
    external: false,
    sideEffects: false,
    namespace: "",
    suffix: "",
    pluginData: null,
  };

  return {
    initialOptions: {},
    resolve: () => Promise.resolve(resolveResult),
    onStart: () => {},
    onEnd: () => {},
    onResolve,
    onLoad,
    onDispose: () => {},
    esbuild,
  };
}

describe("routing/api/module-loader/esbuild-plugin", () => {
  describe("createHTTPPlugin()", () => {
    it("should create a plugin with correct name", () => {
      const plugin = createHTTPPlugin([]);
      assertEquals(plugin.name, "vf-api-http-fetch");
    });

    it("should accept array shorthand for allowed hosts", () => {
      const plugin = createHTTPPlugin(["https://esm.sh"]);
      assertExists(plugin.setup);
    });

    it("should accept options object", () => {
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        strict: true,
      });
      assertExists(plugin.setup);
    });

    it("should have a setup function", () => {
      const plugin = createHTTPPlugin([]);
      assertEquals(typeof plugin.setup, "function");
    });

    it("should register onResolve and onLoad handlers during setup", () => {
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });

      const resolveHandlers: Array<{ filter: RegExp }> = [];
      const loadHandlers: Array<{ filter: RegExp; namespace?: string }> = [];

      const mockBuild = createMockBuild(
        (opts) => {
          resolveHandlers.push(opts);
        },
        (opts) => {
          loadHandlers.push(opts);
        },
      );

      plugin.setup(mockBuild);

      assertEquals(resolveHandlers.length >= 3, true);
      assertEquals(loadHandlers.length >= 1, true);
    });

    it("should register HTTP URL resolver for http:// and https:// patterns", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const httpFilter = resolveFilters[0];
      assertExists(httpFilter);
      assertEquals(httpFilter.test("https://esm.sh/react"), true);
      assertEquals(httpFilter.test("http://cdn.example.com/lib.js"), true);
    });

    it("should register React JSX runtime resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const reactFilter = resolveFilters[1];
      assertExists(reactFilter);
      assertEquals(reactFilter.test("react/jsx-runtime"), true);
      assertEquals(reactFilter.test("react/jsx-dev-runtime"), true);
    });

    it("should register Node core module resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const nodeFilter = resolveFilters[2];
      assertExists(nodeFilter);
      assertEquals(nodeFilter.test("node:path"), true);
      assertEquals(nodeFilter.test("node:fs"), true);
      assertEquals(nodeFilter.test("buffer"), true);
      assertEquals(nodeFilter.test("path"), true);
      assertEquals(nodeFilter.test("fs"), true);
    });

    it("should resolve HTTP URLs to http-url namespace", () => {
      const plugin = createHTTPPlugin([]);

      const resolvers: Array<{
        filter: RegExp;
        fn: (args: OnResolveArgs) => unknown;
      }> = [];

      const mockBuild = createMockBuild(
        (opts, fn) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const httpResolver = resolvers.find((r) => r.filter.test("https://esm.sh/react"));
      assertExists(httpResolver);

      const result = httpResolver.fn({
        path: "https://esm.sh/react",
        importer: "",
        namespace: "",
        resolveDir: "",
        kind: "import-statement",
        pluginData: undefined,
      });

      assertEquals((result as { path: string }).path, "https://esm.sh/react");
      assertEquals((result as { namespace: string }).namespace, "http-url");
    });
  });
});
