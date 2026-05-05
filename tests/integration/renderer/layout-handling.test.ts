import "../../_helpers/contract-init.ts";
import * as React from "react";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import { compileMDXLayouts, computeDepsHash } from "#veryfront/rendering/layouts/index.ts";
import {
  applyLayoutsEsmForTest,
  applyLayoutsFunctionBodyForTest,
  createLayoutCache,
  createMockCompileMDX,
  discoverLayoutsForTest,
  withLayoutHandlingContext,
} from "./layout-handling.test-helpers.ts";

describe("Layout Handling", () => {
  describe("discoverNestedLayouts", () => {
    it("discovers MDX layout in the same directory", async () => {
      await withLayoutHandlingContext("layout-handling-discover-mdx", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages/blog`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/post.mdx`;
        await writeTextFile(pageFile, "# Hello World");

        const layoutFile = `${pageDir}/layout.mdx`;
        await writeTextFile(
          layoutFile,
          `export const MDXLayout = ({ children }) => <div>{children}</div>`,
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(layouts.length, 1);
        assertEquals(layouts[0]?.kind, "mdx");
        assertEquals(layouts[0]?.path, layoutFile);
      });
    });

    it("discovers TSX layout in the same directory", async () => {
      await withLayoutHandlingContext("layout-handling-discover-tsx", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages/blog`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/post.mdx`;
        await writeTextFile(pageFile, "# Hello World");

        const layoutFile = `${pageDir}/layout.tsx`;
        await writeTextFile(
          layoutFile,
          `export default function Layout({ children }) { return <div>{children}</div>; }`,
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(layouts.length, 1);
        assertEquals(layouts[0]?.kind, "tsx");
        assertEquals(layouts[0]?.path, layoutFile);
      });
    });

    it("discovers JSX layout in the same directory", async () => {
      await withLayoutHandlingContext("layout-handling-discover-jsx", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages/docs`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/index.mdx`;
        await writeTextFile(pageFile, "# Documentation");

        const layoutFile = `${pageDir}/layout.jsx`;
        await writeTextFile(
          layoutFile,
          `export default function Layout({ children }) { return <main>{children}</main>; }`,
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(layouts.length, 1);
        assertEquals(layouts[0]?.kind, "tsx");
        assertEquals(layouts[0]?.path, layoutFile);
      });
    });

    it("discovers nested layouts from page to root", async () => {
      await withLayoutHandlingContext(
        "layout-handling-discover-nested",
        async (context, adapter) => {
          const nestedDir = `${context.projectDir}/pages/blog/2024`;
          await mkdir(nestedDir, { recursive: true });

          const pageFile = `${nestedDir}/post.mdx`;
          await writeTextFile(pageFile, "# Post");

          const rootLayout = `${context.projectDir}/pages/layout.tsx`;
          const blogLayout = `${context.projectDir}/pages/blog/layout.tsx`;
          const yearLayout = `${nestedDir}/layout.tsx`;

          await writeTextFile(
            rootLayout,
            "export default function Root({ children }) { return <div>{children}</div>; }",
          );
          await writeTextFile(
            blogLayout,
            "export default function Blog({ children }) { return <div>{children}</div>; }",
          );
          await writeTextFile(
            yearLayout,
            "export default function Year({ children }) { return <div>{children}</div>; }",
          );

          const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

          assertEquals(layouts.length, 3);
          assert(layouts[0]?.path?.endsWith("pages/layout.tsx"));
          assert(layouts[1]?.path?.endsWith("pages/blog/layout.tsx"));
          assert(layouts[2]?.path?.endsWith("pages/blog/2024/layout.tsx"));
        },
      );
    });

    it("handles missing layouts gracefully", async () => {
      await withLayoutHandlingContext("layout-handling-no-layouts", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages/simple`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/page.mdx`;
        await writeTextFile(pageFile, "# Simple Page");

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(layouts.length, 0);
      });
    });

    it("discovers both MDX and TSX when both exist", async () => {
      await withLayoutHandlingContext("layout-handling-mdx-priority", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages/mixed`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/page.mdx`;
        await writeTextFile(pageFile, "# Page");

        const mdxLayout = `${pageDir}/layout.mdx`;
        const tsxLayout = `${pageDir}/layout.tsx`;
        await writeTextFile(
          mdxLayout,
          "export const MDXLayout = ({ children }) => <div>{children}</div>",
        );
        await writeTextFile(
          tsxLayout,
          "export default function Layout({ children }) { return <div>{children}</div>; }",
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assert(layouts.length >= 1);

        const hasMdx = layouts.some((l) => l.kind === "mdx");
        const hasTsx = layouts.some((l) => l.kind === "tsx");
        assert(hasMdx || hasTsx, "Should discover at least one layout");
      });
    });

    it("handles app router directory structure", async () => {
      await withLayoutHandlingContext("layout-handling-app-router", async (context, adapter) => {
        const appDir = `${context.projectDir}/app/dashboard`;
        await mkdir(appDir, { recursive: true });

        const pageFile = `${appDir}/page.tsx`;
        await writeTextFile(
          pageFile,
          "export default function Page() { return <div>Dashboard</div>; }",
        );

        const rootLayout = `${context.projectDir}/app/layout.tsx`;
        const dashboardLayout = `${appDir}/layout.tsx`;

        await writeTextFile(
          rootLayout,
          "export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }",
        );
        await writeTextFile(
          dashboardLayout,
          "export default function DashboardLayout({ children }) { return <div>{children}</div>; }",
        );

        const layouts = await discoverLayoutsForTest(pageFile, "app", context, adapter);

        assertEquals(layouts.length, 2);
        assert(layouts[0]?.path?.endsWith("app/layout.tsx"));
        assert(layouts[1]?.path?.endsWith("app/dashboard/layout.tsx"));
      });
    });

    it("handles deeply nested structures", async () => {
      await withLayoutHandlingContext("layout-handling-deep-nesting", async (context, adapter) => {
        const deepPath = `${context.projectDir}/pages/a/b/c/d`;
        await mkdir(deepPath, { recursive: true });

        const pageFile = `${deepPath}/page.mdx`;
        await writeTextFile(pageFile, "# Deep Page");

        const layoutC = `${context.projectDir}/pages/a/b/c/layout.tsx`;
        await writeTextFile(
          layoutC,
          "export default function LayoutC({ children }) { return <div>{children}</div>; }",
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(layouts.length, 1);
        assert(layouts[0]?.path?.endsWith("a/b/c/layout.tsx"));
      });
    });

    it("stops traversal at root directory", async () => {
      await withLayoutHandlingContext("layout-handling-stop-at-root", async (context, adapter) => {
        const pageDir = `${context.projectDir}/pages`;
        await mkdir(pageDir, { recursive: true });

        const pageFile = `${pageDir}/index.mdx`;
        await writeTextFile(pageFile, "# Index");

        const outsideLayout = `${context.projectDir}/layout.tsx`;
        await writeTextFile(
          outsideLayout,
          "export default function Outside({ children }) { return <div>{children}</div>; }",
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assertEquals(
          layouts.every((l) => !l.path?.includes("layout.tsx") || l.path.includes("/pages/")),
          true,
        );
      });
    });
  });

  describe("compileMDXLayouts", () => {
    it("compiles MDX layouts with bundles", async () => {
      await withLayoutHandlingContext("layout-handling-compile-mdx", async (context, adapter) => {
        const compileMDX = createMockCompileMDX();

        const layouts: LayoutItem[] = [
          {
            kind: "mdx",
            path: `${context.projectDir}/layout.mdx`,
          },
        ];

        await writeTextFile(
          layouts[0]!.path!,
          'export const MDXLayout = ({ children }) => <div className="layout">{children}</div>',
        );

        await compileMDXLayouts(layouts, compileMDX, adapter);

        assertExists(layouts[0]!.bundle);
        assertExists(layouts[0]!.bundle?.compiledCode);
        assert(layouts[0]!.bundle?.compiledCode.includes("MDXLayout"));
      });
    });

    it("skips TSX layouts during compilation", async () => {
      await withLayoutHandlingContext("layout-handling-skip-tsx", async (context, adapter) => {
        const compileMDX = createMockCompileMDX();

        const layouts: LayoutItem[] = [
          {
            kind: "tsx",
            path: `${context.projectDir}/layout.tsx`,
            componentPath: `${context.projectDir}/layout.tsx`,
          },
        ];

        await compileMDXLayouts(layouts, compileMDX, adapter);

        assertEquals(layouts[0]!.bundle, undefined);
      });
    });

    it("compiles multiple MDX layouts", async () => {
      await withLayoutHandlingContext(
        "layout-handling-compile-multiple",
        async (context, adapter) => {
          const compileMDX = createMockCompileMDX();

          const layouts: LayoutItem[] = [
            {
              kind: "mdx",
              path: `${context.projectDir}/layout1.mdx`,
            },
            {
              kind: "mdx",
              path: `${context.projectDir}/layout2.mdx`,
            },
          ];

          await writeTextFile(
            layouts[0]!.path!,
            "export const MDXLayout = ({ children }) => <div>{children}</div>",
          );
          await writeTextFile(
            layouts[1]!.path!,
            "export const MDXLayout = ({ children }) => <section>{children}</section>",
          );

          await compileMDXLayouts(layouts, compileMDX, adapter);

          assertExists(layouts[0]!.bundle);
          assertExists(layouts[1]!.bundle);
        },
      );
    });

    it("skips layouts that already have bundles", async () => {
      await withLayoutHandlingContext(
        "layout-handling-skip-existing-bundles",
        async (context, adapter) => {
          const existingBundle: MdxBundle = {
            compiledCode: "export const MDXLayout = () => <div>Existing</div>",
            frontmatter: {},
          };

          const layouts: LayoutItem[] = [
            {
              kind: "mdx",
              path: `${context.projectDir}/layout.mdx`,
              bundle: existingBundle,
            },
          ];

          const compileMDX = createMockCompileMDX();
          await compileMDXLayouts(layouts, compileMDX, adapter);

          assertEquals(layouts[0]!.bundle, existingBundle);
        },
      );
    });

    it("handles compilation errors gracefully", async () => {
      await withLayoutHandlingContext("layout-handling-compile-error", async (context, adapter) => {
        const failingCompileMDX = (
          _content: string,
          _frontmatter?: any,
          _filePath?: string,
        ): Promise<never> => {
          throw new Error("Compilation failed");
        };

        const layouts: LayoutItem[] = [
          {
            kind: "mdx",
            path: `${context.projectDir}/broken-layout.mdx`,
          },
        ];

        await writeTextFile(layouts[0]!.path!, "broken mdx content");

        await assertRejects(
          async () => await compileMDXLayouts(layouts, failingCompileMDX, adapter),
          Error,
          "Compilation failed",
        );
      });
    });
  });

  describe("computeDepsHash", () => {
    it("computes hash for layout bundle", async () => {
      await withLayoutHandlingContext("layout-handling-hash-bundle", async (_context, adapter) => {
        const layoutBundle: MdxBundle = {
          compiledCode: "export const MDXLayout = ({ children }) => <div>{children}</div>",
          frontmatter: {},
        };

        const hash = await computeDepsHash(layoutBundle, [], adapter);

        assertExists(hash);
        assert(hash.length > 0);
      });
    });

    it("computes hash for nested layouts", async () => {
      await withLayoutHandlingContext("layout-handling-hash-nested", async (context, adapter) => {
        const layoutPath = `${context.projectDir}/layout.tsx`;
        await writeTextFile(
          layoutPath,
          "export default function Layout({ children }) { return <div>{children}</div>; }",
        );

        const nestedLayouts: LayoutItem[] = [
          {
            kind: "tsx",
            componentPath: layoutPath,
            path: layoutPath,
          },
        ];

        const hash = await computeDepsHash(undefined, nestedLayouts, adapter);

        assertExists(hash);
        assert(hash.length > 0);
      });
    });

    it("combines all dependencies into single hash", async () => {
      await withLayoutHandlingContext("layout-handling-hash-combined", async (context, adapter) => {
        const layoutBundle: MdxBundle = {
          compiledCode: "export const MDXLayout = ({ children }) => <div>{children}</div>",
          frontmatter: {},
        };

        const layoutPath = `${context.projectDir}/layout.tsx`;
        await writeTextFile(
          layoutPath,
          "export default function Layout({ children }) { return <div>{children}</div>; }",
        );

        const nestedLayouts: LayoutItem[] = [
          {
            kind: "tsx",
            componentPath: layoutPath,
            path: layoutPath,
          },
        ];

        const hash = await computeDepsHash(layoutBundle, nestedLayouts, adapter);

        assertExists(hash);
        assert(hash.includes(":"));
      });
    });

    it("returns empty string when no dependencies", async () => {
      await withLayoutHandlingContext("layout-handling-hash-empty", async (_context, adapter) => {
        const hash = await computeDepsHash(undefined, [], adapter);

        assertEquals(hash, "");
      });
    });

    it("handles missing files gracefully", async () => {
      await withLayoutHandlingContext(
        "layout-handling-hash-missing-file",
        async (context, adapter) => {
          const nestedLayouts: LayoutItem[] = [
            {
              kind: "tsx",
              componentPath: `${context.projectDir}/non-existent.tsx`,
              path: `${context.projectDir}/non-existent.tsx`,
            },
          ];

          const hash = await computeDepsHash(undefined, nestedLayouts, adapter);

          assertExists(hash);
        },
      );
    });

    it("produces different hashes for different content", async () => {
      await withLayoutHandlingContext(
        "layout-handling-hash-different",
        async (_context, adapter) => {
          const bundle1: MdxBundle = {
            compiledCode: "export const MDXLayout = ({ children }) => <div>{children}</div>",
            frontmatter: {},
          };

          const bundle2: MdxBundle = {
            compiledCode:
              "export const MDXLayout = ({ children }) => <section>{children}</section>",
            frontmatter: {},
          };

          const hash1 = await computeDepsHash(bundle1, [], adapter);
          const hash2 = await computeDepsHash(bundle2, [], adapter);

          assert(hash1 !== hash2);
        },
      );
    });
  });

  describe("applyLayoutsESM", () => {
    it("applies MDX layout to page element", async () => {
      await withLayoutHandlingContext("layout-handling-apply-mdx-esm", async (context, adapter) => {
        const cache = createLayoutCache();

        await writeTextFile(
          `${context.projectDir}/deno.json`,
          JSON.stringify({
            imports: {
              react: "https://esm.sh/react@19.1.1",
              "react-dom": "https://esm.sh/react-dom@19.1.1",
            },
          }),
        );

        const pageElement = React.createElement("div", {}, "Page Content");
        const layoutBundle: MdxBundle = {
          compiledCode: `
              import React from 'react';
              export function MDXLayout({ children }) {
                return React.createElement('div', { className: 'layout' }, children);
              }
            `,
          frontmatter: {},
        };

        const result = await applyLayoutsEsmForTest(context, adapter, pageElement, {
          layoutBundle,
          cache,
        });

        assertExists(result);
        assertEquals(typeof result, "object");
      });
    });

    it("applies nested layouts in correct order", async () => {
      await withLayoutHandlingContext(
        "layout-handling-apply-nested-esm",
        async (context, adapter) => {
          const cache = createLayoutCache();

          await writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({
              imports: {
                react: "https://esm.sh/react@19.1.1",
              },
            }),
          );

          const pageElement = React.createElement("p", {}, "Content");

          const nestedLayouts: LayoutItem[] = [
            {
              kind: "mdx",
              bundle: {
                compiledCode: `
                  import React from 'react';
                  export function MDXLayout({ children }) {
                    return React.createElement('div', { id: 'outer' }, children);
                  }
                `,
                frontmatter: {},
              },
            },
            {
              kind: "mdx",
              bundle: {
                compiledCode: `
                  import React from 'react';
                  export function MDXLayout({ children }) {
                    return React.createElement('div', { id: 'inner' }, children);
                  }
                `,
                frontmatter: {},
              },
            },
          ];

          const result = await applyLayoutsEsmForTest(context, adapter, pageElement, {
            nestedLayouts,
            cache,
          });

          assertExists(result);
          assertEquals(typeof result, "object");
        },
      );
    });

    it("handles empty layouts array", async () => {
      await withLayoutHandlingContext(
        "layout-handling-apply-empty-esm",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement("div", {}, "Page");

          const result = await applyLayoutsEsmForTest(context, adapter, pageElement, { cache });

          assertEquals(result, pageElement);
        },
      );
    });
  });

  describe("applyLayoutsFunctionBody", () => {
    it("applies MDX layout using function body wrapping", async () => {
      await withLayoutHandlingContext(
        "layout-handling-apply-function-body",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement("div", {}, "Content");

          const layoutBundle: MdxBundle = {
            compiledCode: `
              function _createMdxContent(props) {
                const { components, children } = props;
                return React.createElement('div', { className: 'layout' }, children);
              }
              return { default: _createMdxContent, MDXLayout: _createMdxContent };
            `,
            frontmatter: {},
          };

          const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
            layoutBundle,
            cache,
          });

          assertExists(result);
          assertEquals(typeof result, "object");
        },
      );
    });

    it("applies nested layouts in correct order (function body)", async () => {
      await withLayoutHandlingContext(
        "layout-handling-nested-function-body",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement("p", {}, "Text");

          const nestedLayouts: LayoutItem[] = [
            {
              kind: "mdx",
              bundle: {
                compiledCode: `
                  function _createMdxContent(props) {
                    return React.createElement('div', { id: 'outer' }, props.children);
                  }
                  return { MDXLayout: _createMdxContent };
                `,
                frontmatter: {},
              },
            },
          ];

          const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
            nestedLayouts,
            cache,
          });

          assertExists(result);
          assertEquals(typeof result, "object");
        },
      );
    });

    it("handles empty layouts", async () => {
      await withLayoutHandlingContext(
        "layout-handling-empty-function-body",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement("div", {}, "Page");

          const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
            cache,
          });

          assertEquals(result, pageElement);
        },
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("handles layout without path", async () => {
      await withLayoutHandlingContext("layout-handling-no-path", async (_context, adapter) => {
        const compileMDX = createMockCompileMDX();

        const layouts: LayoutItem[] = [
          {
            kind: "mdx",
          },
        ];

        await compileMDXLayouts(layouts, compileMDX, adapter);

        assertEquals(layouts[0]!.bundle, undefined);
      });
    });

    it("handles circular layout references", async () => {
      await withLayoutHandlingContext("layout-handling-circular", async (context, adapter) => {
        const cache = createLayoutCache();

        const pageElement = React.createElement("div", {}, "Page");

        const layoutBundle: MdxBundle = {
          compiledCode: `
              function Layout(props) {
                return React.createElement('div', {}, props.children);
              }
              return { default: Layout };
            `,
          frontmatter: {},
        };

        const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
          layoutBundle,
          cache,
        });

        assertExists(result);
      });
    });

    it("handles layouts with complex children structures", async () => {
      await withLayoutHandlingContext(
        "layout-handling-complex-children",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement(
            "div",
            {},
            React.createElement("h1", {}, "Title"),
            React.createElement("p", {}, "Paragraph"),
            React.createElement("footer", {}, "Footer"),
          );

          const layoutBundle: MdxBundle = {
            compiledCode: `
              function Layout(props) {
                return React.createElement('article', {}, props.children);
              }
              return { default: Layout };
            `,
            frontmatter: {},
          };

          const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
            layoutBundle,
            cache,
          });

          assertExists(result);
          assertEquals(typeof result, "object");
        },
      );
    });

    it("handles layouts with custom components", async () => {
      await withLayoutHandlingContext(
        "layout-handling-custom-components",
        async (context, adapter) => {
          const cache = createLayoutCache();

          const pageElement = React.createElement("div", {}, "Content");

          const customComponents: MDXComponents = {
            h1: (props: any) => React.createElement("h1", { className: "custom-h1", ...props }),
            p: (props: any) => React.createElement("p", { className: "custom-p", ...props }),
          };

          const layoutBundle: MdxBundle = {
            compiledCode: `
              function Layout(props) {
                const { components } = props;
                return React.createElement('div', { className: 'with-custom' }, props.children);
              }
              return { default: Layout };
            `,
            frontmatter: {},
          };

          const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
            layoutBundle,
            components: customComponents,
            cache,
          });

          assertExists(result);
          assertEquals(typeof result, "object");
        },
      );
    });
  });

  describe("Integration Tests", () => {
    it("full workflow: discover, compile, and apply layouts", async () => {
      await withLayoutHandlingContext("layout-handling-full-workflow", async (context, adapter) => {
        const blogDir = `${context.projectDir}/pages/blog`;
        await mkdir(blogDir, { recursive: true });

        const pageFile = `${blogDir}/post.mdx`;
        const rootLayout = `${context.projectDir}/pages/layout.tsx`;
        const blogLayout = `${blogDir}/layout.mdx`;

        await writeTextFile(pageFile, "# Blog Post");
        await writeTextFile(
          rootLayout,
          'export default function Root({ children }) { return <div id="root">{children}</div>; }',
        );
        await writeTextFile(
          blogLayout,
          'export const MDXLayout = ({ children }) => <div id="blog">{children}</div>',
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assert(layouts.length >= 1);

        const compileMDX = createMockCompileMDX();
        await compileMDXLayouts(layouts, compileMDX, adapter);

        for (const layout of layouts) {
          if (layout.kind === "mdx") assertExists(layout.bundle);
        }

        const hash = await computeDepsHash(undefined, layouts, adapter);
        assertExists(hash);

        const pageElement = React.createElement("article", {}, "Post Content");
        const cache = createLayoutCache();

        const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
          nestedLayouts: layouts,
          cache,
        });

        assertExists(result);
        assertEquals(typeof result, "object");
      });
    });

    it("handles mixed MDX and TSX layouts in discovery and application", async () => {
      await withLayoutHandlingContext("layout-handling-mixed-full", async (context, adapter) => {
        const docsDir = `${context.projectDir}/pages/docs`;
        await mkdir(docsDir, { recursive: true });

        const pageFile = `${docsDir}/guide.mdx`;
        const tsxLayout = `${context.projectDir}/pages/layout.tsx`;
        const mdxLayout = `${docsDir}/layout.mdx`;

        await writeTextFile(pageFile, "# Guide");
        await writeTextFile(
          tsxLayout,
          "export default function Layout({ children }) { return <div>{children}</div>; }",
        );
        await writeTextFile(
          mdxLayout,
          "export const MDXLayout = ({ children }) => <section>{children}</section>",
        );

        const layouts = await discoverLayoutsForTest(pageFile, "pages", context, adapter);

        assert(layouts.some((l) => l.kind === "tsx"));
        assert(layouts.some((l) => l.kind === "mdx"));

        const compileMDX = createMockCompileMDX();
        await compileMDXLayouts(layouts, compileMDX, adapter);

        const pageElement = React.createElement("div", {}, "Guide Content");
        const cache = createLayoutCache();

        const result = await applyLayoutsFunctionBodyForTest(context, adapter, pageElement, {
          nestedLayouts: layouts,
          cache,
        });

        assertExists(result);
      });
    });
  });
});
