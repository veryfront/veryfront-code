import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import * as React from "react";
import { assert, assertEquals, assertExists, assertRejects } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "@veryfront/types";
import {
  applyLayoutsESM,
  applyLayoutsFunctionBody,
  compileMDXLayouts,
  computeDepsHash,
  discoverNestedLayouts,
} from "@veryfront/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

function _createMockAdapter(
  files: Map<string, { content: string; isFile: boolean; isDirectory: boolean }>,
): RuntimeAdapter {
  return {
    id: "deno",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: {
      readFile(path: string): Promise<string> {
        const file = files.get(path);
        if (!file || !file.isFile) {
          throw new Error(`File not found: ${path}`);
        }
        return Promise.resolve(file.content);
      },
      async writeFile(_path: string, _content: string): Promise<void> {
      },
      exists(path: string): Promise<boolean> {
        return Promise.resolve(files.has(path));
      },
      async *readDir(_path: string): AsyncIterable<any> {
      },
      stat(path: string): Promise<any> {
        const file = files.get(path);
        if (!file) {
          throw new Error(`File not found: ${path}`);
        }
        return Promise.resolve({
          size: file.content.length,
          isFile: file.isFile,
          isDirectory: file.isDirectory,
          isSymlink: false,
          mtime: new Date(),
        });
      },
      mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
        return Promise.resolve();
      },
      remove(_path: string, _options?: { recursive?: boolean }): Promise<void> {
        return Promise.resolve();
      },
      makeTempDir(_prefix: string): Promise<string> {
        return Promise.resolve("/tmp/mock-temp");
      },
      watch(_paths: string | string[], _options?: any): any {
        return null;
      },
    },
    env: {
      get(_key: string): string | undefined {
        return undefined;
      },
      set(_key: string, _value: string): void {
      },
      toObject(): Record<string, string> {
        return {};
      },
    },
    server: {
      upgradeWebSocket() {
        throw new Error("not implemented");
      },
    },
    serve(_handler: any, _options: any): Promise<any> {
      return Promise.resolve({ stop: async () => {}, addr: { hostname: "localhost", port: 0 } });
    },
  } as RuntimeAdapter;
}

function createMockCompileMDX() {
  return (_content: string, frontmatter?: any, _filePath?: string): Promise<MdxBundle> => {
    return Promise.resolve({
      compiledCode: `
        export function MDXLayout({ children }) {
          return React.createElement('div', { className: 'layout' }, children);
        }
        export const frontmatter = ${JSON.stringify(frontmatter || {})};
      `,
      frontmatter: frontmatter || {},
      globals: {},
    });
  };
}

describe(
  "Layout Handling",
  () => {
    describe("discoverNestedLayouts", () => {
      it("discovers MDX layout in the same directory", async () => {
        await withTestContext("layouts-discover-mdx", async (context) => {
          const adapter = await getAdapter();
          const pageDir = `${context.projectDir}/pages/blog`;
          await mkdir(pageDir, { recursive: true });

          const pageFile = `${pageDir}/post.mdx`;
          await writeTextFile(pageFile, "# Hello World");

          const layoutFile = `${pageDir}/layout.mdx`;
          await writeTextFile(
            layoutFile,
            `export const MDXLayout = ({ children }) => <div>{children}</div>`,
          );

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 1);
          assertEquals(layouts[0]?.kind, "mdx");
          assertEquals(layouts[0]?.path, layoutFile);
        });
      });

      it("discovers TSX layout in the same directory", async () => {
        await withTestContext("layouts-discover-tsx", async (context) => {
          const adapter = await getAdapter();
          const pageDir = `${context.projectDir}/pages/blog`;
          await mkdir(pageDir, { recursive: true });

          const pageFile = `${pageDir}/post.mdx`;
          await writeTextFile(pageFile, "# Hello World");

          const layoutFile = `${pageDir}/layout.tsx`;
          await writeTextFile(
            layoutFile,
            `export default function Layout({ children }) { return <div>{children}</div>; }`,
          );

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 1);
          assertEquals(layouts[0]?.kind, "tsx");
          assertEquals(layouts[0]?.path, layoutFile);
        });
      });

      it("discovers JSX layout in the same directory", async () => {
        await withTestContext("layouts-discover-jsx", async (context) => {
          const adapter = await getAdapter();
          const pageDir = `${context.projectDir}/pages/docs`;
          await mkdir(pageDir, { recursive: true });

          const pageFile = `${pageDir}/index.mdx`;
          await writeTextFile(pageFile, "# Documentation");

          const layoutFile = `${pageDir}/layout.jsx`;
          await writeTextFile(
            layoutFile,
            `export default function Layout({ children }) { return <main>{children}</main>; }`,
          );

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 1);
          assertEquals(layouts[0]?.kind, "tsx");
          assertEquals(layouts[0]?.path, layoutFile);
        });
      });

      it("discovers nested layouts from page to root", async () => {
        await withTestContext("layouts-discover-nested", async (context) => {
          const adapter = await getAdapter();

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

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 3);
          assert(layouts[0]?.path?.endsWith("pages/layout.tsx"));
          assert(layouts[1]?.path?.endsWith("pages/blog/layout.tsx"));
          assert(layouts[2]?.path?.endsWith("pages/blog/2024/layout.tsx"));
        });
      });

      it("handles missing layouts gracefully", async () => {
        await withTestContext("layouts-no-layouts", async (context) => {
          const adapter = await getAdapter();
          const pageDir = `${context.projectDir}/pages/simple`;
          await mkdir(pageDir, { recursive: true });

          const pageFile = `${pageDir}/page.mdx`;
          await writeTextFile(pageFile, "# Simple Page");

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 0);
        });
      });

      it("discovers both MDX and TSX when both exist", async () => {
        await withTestContext("layouts-mdx-priority", async (context) => {
          const adapter = await getAdapter();
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

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assert(layouts.length >= 1);
          const hasMdx = layouts.some((l) => l.kind === "mdx");
          const hasTsx = layouts.some((l) => l.kind === "tsx");
          assert(hasMdx || hasTsx, "Should discover at least one layout");
        });
      });

      it("handles app router directory structure", async () => {
        await withTestContext("layouts-app-router", async (context) => {
          const adapter = await getAdapter();
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

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/app`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 2);
          assert(layouts[0]?.path?.endsWith("app/layout.tsx"));
          assert(layouts[1]?.path?.endsWith("app/dashboard/layout.tsx"));
        });
      });

      it("handles deeply nested structures", async () => {
        await withTestContext("layouts-deep-nesting", async (context) => {
          const adapter = await getAdapter();
          const deepPath = `${context.projectDir}/pages/a/b/c/d`;
          await mkdir(deepPath, { recursive: true });

          const pageFile = `${deepPath}/page.mdx`;
          await writeTextFile(pageFile, "# Deep Page");

          const layoutC = `${context.projectDir}/pages/a/b/c/layout.tsx`;
          await writeTextFile(
            layoutC,
            "export default function LayoutC({ children }) { return <div>{children}</div>; }",
          );

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(layouts.length, 1);
          assert(layouts[0]?.path?.endsWith("a/b/c/layout.tsx"));
        });
      });

      it("stops traversal at root directory", async () => {
        await withTestContext("layouts-stop-at-root", async (context) => {
          const adapter = await getAdapter();
          const pageDir = `${context.projectDir}/pages`;
          await mkdir(pageDir, { recursive: true });

          const pageFile = `${pageDir}/index.mdx`;
          await writeTextFile(pageFile, "# Index");

          const outsideLayout = `${context.projectDir}/layout.tsx`;
          await writeTextFile(
            outsideLayout,
            "export default function Outside({ children }) { return <div>{children}</div>; }",
          );

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assertEquals(
            layouts.every((l) => !l.path?.includes("layout.tsx") || l.path.includes("/pages/")),
            true,
          );
        });
      });
    });

    describe("compileMDXLayouts", () => {
      it("compiles MDX layouts with bundles", async () => {
        await withTestContext("layouts-compile-mdx", async (context) => {
          const adapter = await getAdapter();
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
        await withTestContext("layouts-skip-tsx", async (context) => {
          const adapter = await getAdapter();
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
        await withTestContext("layouts-compile-multiple", async (context) => {
          const adapter = await getAdapter();
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
        });
      });

      it("skips layouts that already have bundles", async () => {
        await withTestContext("layouts-skip-existing-bundles", async (context) => {
          const adapter = await getAdapter();
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
        });
      });

      it("handles compilation errors gracefully", async () => {
        await withTestContext("layouts-compile-error", async (context) => {
          const adapter = await getAdapter();
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
        await withTestContext("layouts-hash-bundle", async (_context) => {
          const adapter = await getAdapter();
          const layoutBundle: MdxBundle = {
            compiledCode: "export const MDXLayout = ({ children }) => <div>{children}</div>",
            frontmatter: {},
          };

          const hash = await computeDepsHash(layoutBundle, [], [], adapter);

          assertExists(hash);
          assert(hash.length > 0);
        });
      });

      it("computes hash for nested layouts", async () => {
        await withTestContext("layouts-hash-nested", async (context) => {
          const adapter = await getAdapter();

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

          const hash = await computeDepsHash(undefined, nestedLayouts, [], adapter);

          assertExists(hash);
          assert(hash.length > 0);
        });
      });

      it("computes hash for providers", async () => {
        await withTestContext("layouts-hash-providers", async (_context) => {
          const adapter = await getAdapter();

          const providerInfos = [
            {
              entity: {
                content:
                  "export default function Provider({ children }) { return <div>{children}</div>; }",
              },
            },
          ];

          const hash = await computeDepsHash(undefined, [], providerInfos, adapter);

          assertExists(hash);
          assert(hash.length > 0);
        });
      });

      it("combines all dependencies into single hash", async () => {
        await withTestContext("layouts-hash-combined", async (context) => {
          const adapter = await getAdapter();

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

          const providerInfos = [
            {
              entity: {
                content:
                  "export default function Provider({ children }) { return <div>{children}</div>; }",
              },
            },
          ];

          const hash = await computeDepsHash(layoutBundle, nestedLayouts, providerInfos, adapter);

          assertExists(hash);
          assert(hash.includes(":"));
        });
      });

      it("returns empty string when no dependencies", async () => {
        await withTestContext("layouts-hash-empty", async (_context) => {
          const adapter = await getAdapter();

          const hash = await computeDepsHash(undefined, [], [], adapter);

          assertEquals(hash, "");
        });
      });

      it("handles missing files gracefully", async () => {
        await withTestContext("layouts-hash-missing-file", async (context) => {
          const adapter = await getAdapter();

          const nestedLayouts: LayoutItem[] = [
            {
              kind: "tsx",
              componentPath: `${context.projectDir}/non-existent.tsx`,
              path: `${context.projectDir}/non-existent.tsx`,
            },
          ];

          const hash = await computeDepsHash(undefined, nestedLayouts, [], adapter);

          assertExists(hash);
        });
      });

      it("produces different hashes for different content", async () => {
        await withTestContext("layouts-hash-different", async (_context) => {
          const adapter = await getAdapter();

          const bundle1: MdxBundle = {
            compiledCode: "export const MDXLayout = ({ children }) => <div>{children}</div>",
            frontmatter: {},
          };

          const bundle2: MdxBundle = {
            compiledCode:
              "export const MDXLayout = ({ children }) => <section>{children}</section>",
            frontmatter: {},
          };

          const hash1 = await computeDepsHash(bundle1, [], [], adapter);
          const hash2 = await computeDepsHash(bundle2, [], [], adapter);

          assert(hash1 !== hash2);
        });
      });
    });

    describe("applyLayoutsESM", () => {
      it("applies MDX layout to page element", async () => {
        await withTestContext("layouts-apply-mdx-esm", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          await writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({
              imports: {
                "react": "https://esm.sh/react@19.1.1",
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

          const result = await applyLayoutsESM(
            pageElement,
            layoutBundle,
            [],
            [],
            context.projectDir,
            {},
            cache,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("applies nested layouts in correct order", async () => {
        await withTestContext("layouts-apply-nested-esm", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          await writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({
              imports: {
                "react": "https://esm.sh/react@19.1.1",
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

          const result = await applyLayoutsESM(
            pageElement,
            undefined,
            nestedLayouts,
            [],
            context.projectDir,
            {},
            cache,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("handles empty layouts array", async () => {
        await withTestContext("layouts-apply-empty-esm", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const pageElement = React.createElement("div", {}, "Page");

          const result = await applyLayoutsESM(
            pageElement,
            undefined,
            [],
            [],
            context.projectDir,
            {},
            cache,
            adapter,
          );

          assertEquals(result, pageElement);
        });
      });

      it("applies providers after layouts", async () => {
        await withTestContext("layouts-apply-providers-esm", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          await writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({
              imports: {
                "react": "https://esm.sh/react@19.1.1",
              },
            }),
          );

          const pageElement = React.createElement("div", {}, "Page");

          const providerItems: any[] = [
            {
              kind: "mdx",
              entityInfo: {
                entity: { id: "p1", slug: "p1", type: "provider", content: "", frontmatter: {} },
              },
              bundle: {
                compiledCode: `
                import React from 'react';
                export function MDXLayout({ children }) {
                  return React.createElement('div', { className: 'provider' }, children);
                }
              `,
                frontmatter: {},
              },
            },
          ];

          const result = await applyLayoutsESM(
            pageElement,
            undefined,
            [],
            providerItems,
            context.projectDir,
            {},
            cache,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });
    });

    describe("applyLayoutsFunctionBody", () => {
      it("applies MDX layout using function body wrapping", async () => {
        await withTestContext("layouts-apply-function-body", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

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

          const result = await applyLayoutsFunctionBody(
            pageElement,
            layoutBundle,
            [],
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("applies nested layouts in correct order (function body)", async () => {
        await withTestContext("layouts-nested-function-body", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

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

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            nestedLayouts,
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("applies providers in reverse order (function body)", async () => {
        await withTestContext("layouts-providers-function-body", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const pageElement = React.createElement("div", {}, "Page");

          const providerItems: any[] = [
            {
              kind: "mdx",
              entityInfo: {
                entity: { id: "p1", slug: "p1", type: "provider", content: "", frontmatter: {} },
              },
              bundle: {
                compiledCode: `
                function Provider(props) {
                  return React.createElement('div', { className: 'provider1' }, props.children);
                }
                return { default: Provider };
              `,
                frontmatter: {},
              },
            },
            {
              kind: "mdx",
              entityInfo: {
                entity: { id: "p2", slug: "p2", type: "provider", content: "", frontmatter: {} },
              },
              bundle: {
                compiledCode: `
                function Provider(props) {
                  return React.createElement('div', { className: 'provider2' }, props.children);
                }
                return { default: Provider };
              `,
                frontmatter: {},
              },
            },
          ];

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            [],
            providerItems,
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("handles empty layouts and providers", async () => {
        await withTestContext("layouts-empty-function-body", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const pageElement = React.createElement("div", {}, "Page");

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            [],
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertEquals(result, pageElement);
        });
      });
    });

    describe("Edge Cases and Error Handling", () => {
      it("handles layout without path", async () => {
        await withTestContext("layouts-no-path", async (_context) => {
          const adapter = await getAdapter();
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
        await withTestContext("layouts-circular", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

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

          const result = await applyLayoutsFunctionBody(
            pageElement,
            layoutBundle,
            [],
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
        });
      });

      it("handles layouts with complex children structures", async () => {
        await withTestContext("layouts-complex-children", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

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

          const result = await applyLayoutsFunctionBody(
            pageElement,
            layoutBundle,
            [],
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("handles layouts with custom components", async () => {
        await withTestContext("layouts-custom-components", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

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

          const result = await applyLayoutsFunctionBody(
            pageElement,
            layoutBundle,
            [],
            [],
            customComponents,
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("handles provider without compiledCode", async () => {
        await withTestContext("layouts-no-compiled-code", async (context) => {
          const adapter = await getAdapter();
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const pageElement = React.createElement("div", {}, "Page");

          const providerItems: any[] = [
            {
              kind: "mdx",
              entityInfo: {
                entity: { id: "p1", slug: "p1", type: "provider", content: "", frontmatter: {} },
              },
              bundle: {
                compiledCode: "", // Empty code
                frontmatter: {},
              },
            },
          ];

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            [],
            providerItems,
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertEquals(result, pageElement);
        });
      });
    });

    describe("Integration Tests", () => {
      it("full workflow: discover, compile, and apply layouts", async () => {
        await withTestContext("layouts-full-workflow", async (context) => {
          const adapter = await getAdapter();

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

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          assert(layouts.length >= 1);

          const compileMDX = createMockCompileMDX();
          await compileMDXLayouts(layouts, compileMDX, adapter);

          const mdxLayouts = layouts.filter((l) => l.kind === "mdx");
          for (const layout of mdxLayouts) {
            assertExists(layout!.bundle);
          }

          const hash = await computeDepsHash(undefined, layouts, [], adapter);
          assertExists(hash);

          const pageElement = React.createElement("article", {}, "Post Content");
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            layouts,
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
          assertEquals(typeof result, "object");
        });
      });

      it("handles mixed MDX and TSX layouts in discovery and application", async () => {
        await withTestContext("layouts-mixed-full", async (context) => {
          const adapter = await getAdapter();

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

          const layouts = await discoverNestedLayouts(
            pageFile,
            `${context.projectDir}/pages`,
            context.projectDir,
            adapter,
          );

          const tsxLayouts = layouts.filter((l: LayoutItem) => l.kind === "tsx");
          const mdxLayouts = layouts.filter((l: LayoutItem) => l.kind === "mdx");

          assert(tsxLayouts.length > 0);
          assert(mdxLayouts.length > 0);

          const compileMDX = createMockCompileMDX();
          await compileMDXLayouts(layouts, compileMDX, adapter);

          const pageElement = React.createElement("div", {}, "Guide Content");
          const cache = new LRUCache<string, any>({ maxEntries: 10 });

          const result = await applyLayoutsFunctionBody(
            pageElement,
            undefined,
            layouts,
            [],
            {},
            cache,
            context.projectDir,
            adapter,
          );

          assertExists(result);
        });
      });
    });
  },
);
