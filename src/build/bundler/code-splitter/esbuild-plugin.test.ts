import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSplitterPlugin } from "./esbuild-plugin.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";

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

    it("should handle .md resolve with mdx namespace", () => {
      const plugin = createSplitterPlugin("/my-project");
      // deno-lint-ignore no-explicit-any
      let mdxResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("test.md")) {
            mdxResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      const result = mdxResolver({ path: "pages/testxxx.md" });
      assertEquals(result?.namespace, "mdx");
      assertEquals(result?.path.includes("pages/testxxx.md"), true);
    });

    it("compiles MDX source instead of returning placeholder content", async () => {
      const projectDir = await Deno.makeTempDir();
      const sourcePath = `${projectDir}/page.mdx`;
      await Deno.writeTextFile(sourcePath, "# Real heading");
      const plugin = createSplitterPlugin(projectDir);
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

      try {
        const result = await mdxLoader({ path: sourcePath });
        assertEquals(result?.loader, "js");
        assertEquals(typeof result?.contents, "string");
        assertEquals(result?.contents.includes("Real heading"), true);
        assertEquals(result?.contents.includes('return "MDX Component"'), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects MDX paths outside the project directory", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let mdxResolver: (args: any) => any = () => null;
      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("page.mdx")) mdxResolver = cb;
        },
        onLoad() {},
        onDispose() {},
      };
      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      assertThrows(
        () => mdxResolver({ path: "../outside/page.mdx", resolveDir: "/project" }),
        TypeError,
        "outside projectDir",
      );
    });

    it("rejects MDX sources that are symbolic links", async () => {
      const projectDir = await Deno.makeTempDir();
      const outsideDir = await Deno.makeTempDir();
      const outsidePath = `${outsideDir}/outside.mdx`;
      const sourcePath = `${projectDir}/page.mdx`;
      try {
        await Deno.writeTextFile(outsidePath, "# Outside");
        await Deno.symlink(outsidePath, sourcePath);
        const plugin = createSplitterPlugin(projectDir);
        // deno-lint-ignore no-explicit-any
        let mdxLoader: (args: any) => any = () => null;
        const mockBuild = {
          onResolve() {},
          // deno-lint-ignore no-explicit-any
          onLoad(opts: { namespace?: string }, cb: (args: unknown) => unknown) {
            if (opts.namespace === "mdx") mdxLoader = cb;
          },
          onDispose() {},
        };
        // deno-lint-ignore no-explicit-any
        plugin.setup(mockBuild as any);

        await assertRejects(
          () => mdxLoader({ path: sourcePath }),
          TypeError,
          "regular project files",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outsideDir, { recursive: true });
      }
    });
  });
});
