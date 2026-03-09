import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSplitterPlugin } from "./esbuild-plugin.ts";

describe("build/bundler/code-splitter/esbuild-plugin", () => {
  describe("createSplitterPlugin", () => {
    it("should return a plugin with name 'veryfront-splitter'", () => {
      const plugin = createSplitterPlugin("/project");
      assertEquals(plugin.name, "veryfront-splitter");
    });

    it("should have a setup function", () => {
      const plugin = createSplitterPlugin("/project");
      assertEquals(typeof plugin.setup, "function");
    });

    it("should register onResolve and onLoad handlers via setup", () => {
      const plugin = createSplitterPlugin("/project");
      const registered: { type: string; filter: RegExp }[] = [];

      const mockBuild = {
        onResolve(opts: { filter: RegExp }, _cb: unknown) {
          registered.push({ type: "onResolve", filter: opts.filter });
        },
        onLoad(opts: { filter: RegExp; namespace?: string }, _cb: unknown) {
          registered.push({ type: "onLoad", filter: opts.filter });
        },
        onDispose(_cb: unknown) {
          registered.push({ type: "onDispose", filter: /.*/ });
        },
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      const resolveHandlers = registered.filter((r) => r.type === "onResolve");
      const loadHandlers = registered.filter((r) => r.type === "onLoad");
      const disposeHandlers = registered.filter((r) => r.type === "onDispose");

      assertEquals(resolveHandlers.length, 2, "should register 2 onResolve handlers");
      assertEquals(loadHandlers.length, 1, "should register 1 onLoad handler");
      assertEquals(disposeHandlers.length, 1, "should register 1 onDispose handler");
    });

    it("should handle react resolve by marking as external", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let reactResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("react")) {
            reactResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      // React should be external
      const result = reactResolver({ path: "react" });
      assertEquals(result?.external, true);
      assertEquals(result?.path, "react");
    });

    it("should return null for unknown react sub-paths not in import map", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let reactResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("react")) {
            reactResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      // An unknown react path not in the import map should return null
      const result = reactResolver({ path: "react-nonexistent-package" });
      assertEquals(result, null);
    });

    it("should handle .mdx resolve with mdx namespace", () => {
      const plugin = createSplitterPlugin("/my-project");
      // deno-lint-ignore no-explicit-any
      let mdxResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("test.mdx")) {
            mdxResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      const result = mdxResolver({ path: "content/page.mdx" });
      assertEquals(result?.namespace, "mdx");
      assertEquals(result?.path.includes("content/page.mdx"), true);
    });

    it("should provide stub content for MDX files", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let mdxLoader: (args: any) => any = () => null;

      const mockBuild = {
        onResolve() {},
        // deno-lint-ignore no-explicit-any
        onLoad(opts: { filter: RegExp; namespace?: string }, cb: (args: any) => any) {
          if (opts.namespace === "mdx") {
            mdxLoader = cb;
          }
        },
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      const result = mdxLoader({ path: "/project/page.mdx" });
      assertEquals(result?.loader, "jsx");
      assertEquals(typeof result?.contents, "string");
      assertEquals(result?.contents.includes("MDXComponent"), true);
    });
  });
});
