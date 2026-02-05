import * as React from "react";
import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { clearMDXRendererCache, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

// These tests use AsyncLocalStorage + dynamic import patterns that work in Deno
// but have timing issues in Bun's test runner. The core functionality is verified
// to work correctly - the issue is with how Bun's test runner handles the async flow.
const denoOnlyIt = isDeno ? it : it.skip;

// Each test runs with its own isolated cache directory via AsyncLocalStorage.
// This prevents the VF_CACHE_DIR env var leak from other parallel tests.
async function withIsolatedCache<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const cacheDir = await makeTempDir({ prefix: "veryfront_mdx_test_" });
  const projectDir = await makeTempDir({ prefix: "veryfront_mdx_project_" });

  try {
    return await runWithCacheDir(cacheDir, async () => {
      clearMDXRendererCache();

      try {
        return await fn(projectDir);
      } finally {
        clearMDXRendererCache();
      }
    });
  } finally {
    try {
      await remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    try {
      await remove(projectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function loadESM(projectDir: string, code: string): Promise<any> {
  return await mdxRenderer.loadModuleESM(
    code,
    undefined,
    "test-mdx",
    projectDir,
    "test-mdx",
    "test",
  );
}

describe(
  "MDX renderer - ESM Loader (Secure)",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    denoOnlyIt("renders program-format MDXContent", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export const frontmatter = { title: "Hello" };
        export function MDXContent(){
          return jsx("div", { children: "hi" });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();

        assert(React.isValidElement(el));
        assertEquals(el.type, "div");
        assertEquals((el.props as any).children, "hi");
      });
    });

    denoOnlyIt("extractLayout prefers MDXLayout", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export const MDXLayout = ({ children }) => jsx("section", { children });
        export function MDXContent(){
          return jsx("div", { children: "content" });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Layout = (mod.MDXLayout || mod.__vfLayout) as (
          props: { children: React.ReactNode },
        ) => React.ReactElement;

        const child = React.createElement("span", null, "X");
        const el = Layout({ children: child });

        assert(React.isValidElement(el));
        assertEquals(el.type, "section");
        assertEquals(((el.props as any).children as any).type, "span");
      });
    });

    denoOnlyIt("supports ESM format with exports", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){
          return jsx('p', { children: 'foo' });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();

        assert(React.isValidElement(el));
        assertEquals(el.type, "p");
        assertEquals((el.props as any).children, "foo");
      });
    });

    denoOnlyIt("handles errors gracefully with ESM loader", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){ throw new Error('boom'); }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;

        try {
          Component();
          assert(false, "Should have thrown");
        } catch (err) {
          assertEquals((err as Error).message, "boom");
        }
      });
    });

    denoOnlyIt("handles frontmatter extraction", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export const frontmatter = {
          title: "Test Page",
          description: "Test description",
          author: "Test Author"
        };
        export function MDXContent(){
          return jsx("div", { children: "content" });
        }
      `;
        const mod = await loadESM(projectDir, compiled);

        assertEquals(mod.frontmatter?.title, "Test Page");
        assertEquals(mod.frontmatter?.description, "Test description");
        assertEquals(mod.frontmatter?.author, "Test Author");
      });
    });

    denoOnlyIt("renders with custom components", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(props){
          const { components } = props;
          const H1 = components?.h1 || 'h1';
          return jsx(H1, { children: "Heading" });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as (
          props: { components?: Record<string, any> },
        ) => React.ReactElement;

        const customH1 = (props: any) => React.createElement("header", null, props.children);
        const el = Component({ components: { h1: customH1 } });

        assert(React.isValidElement(el));
        assertEquals(typeof el.type, "function");
        assertEquals((el.props as any).children, "Heading");

        const rendered = (el.type as any)(el.props);
        assertEquals((rendered as any).type, "header");
      });
    });

    denoOnlyIt("handles MDX without external imports", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){
          return jsx("div", {
            children: [
              jsx("span", { key: "custom", children: "Custom" }),
              "text"
            ]
          });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();

        assert(React.isValidElement(el));
        assertEquals(el.type, "div");
      });
    });

    denoOnlyIt("renders nested MDX elements", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx, jsxs } from "react/jsx-runtime";
        export function MDXContent(){
          return jsxs("article", {
            children: [
              jsx("h1", { children: "Title" }),
              jsx("p", { children: "Paragraph" }),
              jsx("ul", {
                children: [
                  jsx("li", { children: "Item 1" }),
                  jsx("li", { children: "Item 2" })
                ]
              })
            ]
          });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();

        assert(React.isValidElement(el));
        assertEquals(el.type, "article");
      });
    });

    denoOnlyIt("handles MDX with expressions", async () => {
      await withIsolatedCache(async (projectDir) => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){
          const value = 42;
          return jsx("div", { children: \`The answer is \${value}\` });
        }
      `;
        const mod = await loadESM(projectDir, compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();

        assert(React.isValidElement(el));
        assertEquals((el.props as any).children, "The answer is 42");
      });
    });
  },
);

describe(
  "MDX ESM loader",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    denoOnlyIt("loads simple module and caches", async () => {
      await withIsolatedCache(async (projectDir) => {
        const code = `
        export const title = "T";
        export const MDXLayout = ({ children }) => jsx('div', { children });
        export function MDXContent(){ return jsx('p', { children: 'ok' }); }
      `;
        const mod1 = await loadESM(projectDir, code);

        assertEquals(typeof mod1.title, "string");
        assert(mod1.MDXLayout || mod1.__vfLayout !== undefined);

        const mod2 = await loadESM(projectDir, code);
        assert(mod1 === mod2);
      });
    });

    denoOnlyIt("loads module with exports", async () => {
      await withIsolatedCache(async (projectDir) => {
        const code = `
        export const metadata = { title: "Test", slug: "test-page" };
        export const config = { layout: "default" };
        export function MDXContent(){ return jsx('div', { children: 'content' }); }
      `;
        const mod = await loadESM(projectDir, code);

        assert(mod.metadata);
        assert(mod.config);
      });
    });

    denoOnlyIt("handles module with default export", async () => {
      await withIsolatedCache(async (projectDir) => {
        const code = `
        export default function DefaultComponent() {
          return jsx('main', { children: 'Default' });
        }
        export const MDXContent = DefaultComponent;
      `;
        const mod = await loadESM(projectDir, code);

        assert(mod.default || mod.MDXContent);
      });
    });

    denoOnlyIt("caches modules by code content", async () => {
      await withIsolatedCache(async (projectDir) => {
        const code1 = `export function MDXContent(){ return jsx('p', { children: '1' }); }`;
        const code2 = `export function MDXContent(){ return jsx('p', { children: '2' }); }`;

        const mod1 = await loadESM(projectDir, code1);
        const mod2 = await loadESM(projectDir, code2);
        const mod1Again = await loadESM(projectDir, code1);

        assert(mod1 === mod1Again);
        assert(mod1 !== mod2);
      });
    });

    denoOnlyIt("loads complex module with multiple exports", async () => {
      await withIsolatedCache(async (projectDir) => {
        const code = `
        export const frontmatter = { title: "Complex", tags: ["test", "mdx"] };
        export const getStaticProps = () => ({ props: {} });
        export const Layout = ({ children }) => jsx('div', { className: 'layout', children });
        export function MDXContent(props) {
          const { Layout: LayoutComponent } = props.components || {};
          const content = jsx('article', { children: 'Article content' });
          return LayoutComponent ? jsx(LayoutComponent, { children: content }) : content;
        }
      `;
        const mod = await loadESM(projectDir, code);

        assert(mod.frontmatter);
        assert(mod.getStaticProps);
        assert(mod.Layout);
        assert(mod.MDXContent);
      });
    });
  },
);
