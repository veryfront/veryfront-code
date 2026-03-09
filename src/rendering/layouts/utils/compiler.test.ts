import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileMDXLayouts } from "./compiler.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(files: Record<string, string> = {}): RuntimeAdapter {
  return {
    fs: {
      readFile: async (path: string) => {
        if (path in files) return files[path];
        throw new Error(`File not found: ${path}`);
      },
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createMockCompileMDX(
  _returnBundle?: MdxBundle,
): (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle> {
  return async (content: string, _frontmatter?: Record<string, unknown>, _filePath?: string) => ({
    compiledCode: `compiled:${content}`,
    frontmatter: {},
    globals: {},
    headings: [],
    nodeMap: new Map(),
  });
}

describe("rendering/layouts/utils/compiler", () => {
  describe("compileMDXLayouts", () => {
    it("should do nothing when layouts array is empty", async () => {
      const adapter = createMockAdapter();
      const compile = createMockCompileMDX();
      await compileMDXLayouts([], compile, adapter);
      // No error thrown = success
    });

    it("should skip non-mdx layouts", async () => {
      const adapter = createMockAdapter();
      const compile = createMockCompileMDX();
      const layouts: LayoutItem[] = [
        { kind: "tsx", path: "/layout.tsx" } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      // tsx layouts should be skipped, no bundle assigned
      assertEquals(layouts[0].bundle, undefined);
    });

    it("should skip mdx layouts that already have a bundle", async () => {
      const adapter = createMockAdapter({ "/layout.mdx": "# Hello" });
      const compile = createMockCompileMDX();
      const existingBundle = {
        compiledCode: "already compiled",
        frontmatter: {},
        globals: {},
        headings: [],
        nodeMap: new Map(),
      };
      const layouts: LayoutItem[] = [
        { kind: "mdx", path: "/layout.mdx", bundle: existingBundle } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      assertEquals(layouts[0].bundle?.compiledCode, "already compiled");
    });

    it("should skip mdx layouts without a path", async () => {
      const adapter = createMockAdapter();
      const compile = createMockCompileMDX();
      const layouts: LayoutItem[] = [
        { kind: "mdx" } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      assertEquals(layouts[0].bundle, undefined);
    });

    it("should compile mdx layouts and assign bundles", async () => {
      const adapter = createMockAdapter({ "/layout.mdx": "# Title\n\nContent" });
      const compile = createMockCompileMDX();
      const layouts: LayoutItem[] = [
        { kind: "mdx", path: "/layout.mdx" } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      assertEquals(layouts[0].bundle?.compiledCode, "compiled:# Title\n\nContent");
    });

    it("should compile multiple mdx layouts in parallel", async () => {
      const adapter = createMockAdapter({
        "/a.mdx": "layout a",
        "/b.mdx": "layout b",
      });
      const compile = createMockCompileMDX();
      const layouts: LayoutItem[] = [
        { kind: "mdx", path: "/a.mdx" } as unknown as LayoutItem,
        { kind: "mdx", path: "/b.mdx" } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      assertEquals(layouts[0].bundle?.compiledCode, "compiled:layout a");
      assertEquals(layouts[1].bundle?.compiledCode, "compiled:layout b");
    });

    it("should only compile mdx layouts, leaving tsx untouched", async () => {
      const adapter = createMockAdapter({
        "/a.mdx": "mdx content",
      });
      const compile = createMockCompileMDX();
      const layouts: LayoutItem[] = [
        { kind: "tsx", path: "/layout.tsx" } as unknown as LayoutItem,
        { kind: "mdx", path: "/a.mdx" } as unknown as LayoutItem,
      ];
      await compileMDXLayouts(layouts, compile, adapter);
      assertEquals(layouts[0].bundle, undefined);
      assertEquals(layouts[1].bundle?.compiledCode, "compiled:mdx content");
    });
  });
});
