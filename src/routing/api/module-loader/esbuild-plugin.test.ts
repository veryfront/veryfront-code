import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHTTPPlugin } from "./esbuild-plugin.ts";

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

      const mockBuild = {
        onResolve: (opts: { filter: RegExp }, _fn: unknown) => {
          resolveHandlers.push(opts);
        },
        onLoad: (opts: { filter: RegExp; namespace?: string }, _fn: unknown) => {
          loadHandlers.push(opts);
        },
      };

      plugin.setup(mockBuild as Parameters<typeof plugin.setup>[0]);

      // Should register multiple onResolve handlers
      assertEquals(resolveHandlers.length >= 3, true);
      // Should register at least one onLoad handler
      assertEquals(loadHandlers.length >= 1, true);
    });

    it("should register HTTP URL resolver for http:// and https:// patterns", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = {
        onResolve: (opts: { filter: RegExp }, _fn: unknown) => {
          resolveFilters.push(opts.filter);
        },
        onLoad: () => {},
      };

      plugin.setup(mockBuild as Parameters<typeof plugin.setup>[0]);

      // First resolver should match http/https URLs
      const httpFilter = resolveFilters[0];
      assertEquals(httpFilter.test("https://esm.sh/react"), true);
      assertEquals(httpFilter.test("http://cdn.example.com/lib.js"), true);
    });

    it("should register React JSX runtime resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = {
        onResolve: (opts: { filter: RegExp }, _fn: unknown) => {
          resolveFilters.push(opts.filter);
        },
        onLoad: () => {},
      };

      plugin.setup(mockBuild as Parameters<typeof plugin.setup>[0]);

      // Second resolver should match react/jsx-runtime
      const reactFilter = resolveFilters[1];
      assertEquals(reactFilter.test("react/jsx-runtime"), true);
      assertEquals(reactFilter.test("react/jsx-dev-runtime"), true);
    });

    it("should register Node core module resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = {
        onResolve: (opts: { filter: RegExp }, _fn: unknown) => {
          resolveFilters.push(opts.filter);
        },
        onLoad: () => {},
      };

      plugin.setup(mockBuild as Parameters<typeof plugin.setup>[0]);

      // Third resolver should match node: builtins and bare specifiers
      const nodeFilter = resolveFilters[2];
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
        fn: (args: { path: string; namespace?: string; importer?: string }) => unknown;
      }> = [];
      const mockBuild = {
        onResolve: (
          opts: { filter: RegExp },
          fn: (args: { path: string; namespace?: string; importer?: string }) => unknown,
        ) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        onLoad: () => {},
      };

      plugin.setup(mockBuild as Parameters<typeof plugin.setup>[0]);

      // Find the HTTP URL resolver (first one, matching http/https)
      const httpResolver = resolvers.find((r) => r.filter.test("https://esm.sh/react"));
      assertExists(httpResolver);

      const result = httpResolver.fn({ path: "https://esm.sh/react" });
      assertEquals((result as { path: string }).path, "https://esm.sh/react");
      assertEquals((result as { namespace: string }).namespace, "http-url");
    });
  });
});
