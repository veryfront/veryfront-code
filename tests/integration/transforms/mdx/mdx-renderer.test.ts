import * as React from "https://esm.sh/react@18.3.1";
import { assert, assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { clearMDXRendererCache, mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import { runWithCacheDir } from "@veryfront/utils/cache-dir.ts";

// Each test runs with its own isolated cache directory via AsyncLocalStorage.
// This prevents the VF_CACHE_DIR env var leak from other parallel tests.
async function withIsolatedCache<T>(fn: () => Promise<T>): Promise<T> {
  // Create a unique temp dir for this test's cache
  const cacheDir = await Deno.makeTempDir({ prefix: "veryfront_mdx_test_" });

  try {
    // Run with isolated cache using AsyncLocalStorage
    return await runWithCacheDir(cacheDir, async () => {
      // Clear the singleton's state to start fresh
      clearMDXRendererCache();
      try {
        return await fn();
      } finally {
        clearMDXRendererCache();
      }
    });
  } finally {
    // Clean up the temp cache directory
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe(
  "MDX renderer - ESM Loader (Secure)",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("renders program-format MDXContent", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export const frontmatter = { title: "Hello" };
        export function MDXContent(){
          return jsx("div", { children: "hi" });
        }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();
        assert(React.isValidElement(el));
        assertEquals((el as any).type, "div");
        assertEquals((el as any).props.children, "hi");
      });
    });

    it("extractLayout prefers MDXLayout", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export const MDXLayout = ({ children }) => jsx("section", { children });
        export function MDXContent(){
          return jsx("div", { children: "content" });
        }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Layout = (mod.MDXLayout || mod.__vfLayout) as (
          props: { children: React.ReactNode },
        ) => React.ReactElement;
        const child = React.createElement("span", null, "X");
        const el = Layout({ children: child });
        assert(React.isValidElement(el));
        assertEquals((el as any).type, "section");
        assertEquals(((el as any).props.children as any).type, "span");
      });
    });

    it("supports ESM format with exports", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){
          return jsx('p', { children: 'foo' });
        }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();
        assert(React.isValidElement(el));
        assertEquals((el as any).type, "p");
        assertEquals((el as any).props.children, "foo");
      });
    });

    it("handles errors gracefully with ESM loader", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){ throw new Error('boom'); }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        try {
          Component();
          assert(false, "Should have thrown");
        } catch (err) {
          assertEquals((err as Error).message, "boom");
        }
      });
    });

    it("handles frontmatter extraction", async () => {
      await withIsolatedCache(async () => {
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
        const mod = await mdxRenderer.loadModuleESM(compiled);
        assertEquals(mod.frontmatter?.title, "Test Page");
        assertEquals(mod.frontmatter?.description, "Test description");
        assertEquals(mod.frontmatter?.author, "Test Author");
      });
    });

    it("renders with custom components", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(props){
          const { components } = props;
          const H1 = components?.h1 || 'h1';
          return jsx(H1, { children: "Heading" });
        }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as (
          props: { components?: Record<string, any> },
        ) => React.ReactElement;
        const customH1 = (props: any) => React.createElement("header", null, props.children);
        const el = Component({ components: { h1: customH1 } });
        assert(React.isValidElement(el));
        assertEquals(typeof (el as any).type, "function");
        assertEquals((el as any).props.children, "Heading");
        const rendered = (el as any).type((el as any).props);
        assertEquals((rendered as any).type, "header");
      });
    });

    it("handles MDX without external imports", async () => {
      await withIsolatedCache(async () => {
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
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();
        assert(React.isValidElement(el));
        assertEquals((el as any).type, "div");
      });
    });

    it("renders nested MDX elements", async () => {
      await withIsolatedCache(async () => {
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
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();
        assert(React.isValidElement(el));
        assertEquals((el as any).type, "article");
      });
    });

    it("handles MDX with expressions", async () => {
      await withIsolatedCache(async () => {
        const compiled = `
        import { jsx } from "react/jsx-runtime";
        export function MDXContent(){
          const value = 42;
          return jsx("div", { children: \`The answer is \${value}\` });
        }
      `;
        const mod = await mdxRenderer.loadModuleESM(compiled);
        const Component = mod.MDXContent as () => React.ReactElement;
        const el = Component();
        assert(React.isValidElement(el));
        assertEquals((el as any).props.children, "The answer is 42");
      });
    });
  },
);

describe(
  "MDX ESM loader",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("loads simple module and caches", async () => {
      await withIsolatedCache(async () => {
        const code = `
        export const title = "T";
        export const MDXLayout = ({ children }) => jsx('div', { children });
        export function MDXContent(){ return jsx('p', { children: 'ok' }); }
      `;
        const mod1 = await mdxRenderer.loadModuleESM(code);
        assertEquals(typeof mod1.title, "string");
        assert(mod1.MDXLayout || (mod1 as any).__vfLayout !== undefined);
        const mod2 = await mdxRenderer.loadModuleESM(code);
        assert(mod1 === mod2);
      });
    });

    it("loads module with exports", async () => {
      await withIsolatedCache(async () => {
        const code = `
        export const metadata = { title: "Test", slug: "test-page" };
        export const config = { layout: "default" };
        export function MDXContent(){ return jsx('div', { children: 'content' }); }
      `;
        const mod = await mdxRenderer.loadModuleESM(code);
        assert((mod as any).metadata);
        assert((mod as any).config);
      });
    });

    it("handles module with default export", async () => {
      await withIsolatedCache(async () => {
        const code = `
        export default function DefaultComponent() {
          return jsx('main', { children: 'Default' });
        }
        export const MDXContent = DefaultComponent;
      `;
        const mod = await mdxRenderer.loadModuleESM(code);
        assert(mod.default || mod.MDXContent);
      });
    });

    it("caches modules by code content", async () => {
      await withIsolatedCache(async () => {
        const code1 = `export function MDXContent(){ return jsx('p', { children: '1' }); }`;
        const code2 = `export function MDXContent(){ return jsx('p', { children: '2' }); }`;

        const mod1 = await mdxRenderer.loadModuleESM(code1);
        const mod2 = await mdxRenderer.loadModuleESM(code2);
        const mod1Again = await mdxRenderer.loadModuleESM(code1);

        assert(mod1 === mod1Again);
        assert(mod1 !== mod2);
      });
    });

    it("loads complex module with multiple exports", async () => {
      await withIsolatedCache(async () => {
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
        const mod = await mdxRenderer.loadModuleESM(code);
        assert((mod as any).frontmatter);
        assert((mod as any).getStaticProps);
        assert((mod as any).Layout);
        assert(mod.MDXContent);
      });
    });
  },
);
