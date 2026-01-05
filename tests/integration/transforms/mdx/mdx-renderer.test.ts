import * as React from "https://esm.sh/react@18.3.1";
import { assert, assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";

describe(
  "MDX renderer - ESM Loader (Secure)",
  () => {
    it("renders program-format MDXContent", async () => {
      const compiled = `
      import { jsx } from "react/jsx-runtime";
      export const frontmatter = { title: "Hello" };
      export function MDXContent(){
        return jsx("div", { children: "hi" });
      }
    `;
      const mod = await mdxRenderer.loadModuleESM(compiled);
      const Component = mod.MDXContent as () => React.ReactElement;
      const el = Component(); // Call the component function directly
      assert(React.isValidElement(el));
      assertEquals((el as any).type, "div");
      assertEquals((el as any).props.children, "hi");
    });

    it("extractLayout prefers MDXLayout", async () => {
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
      const el = Layout({ children: child }); // Call the layout function
      assert(React.isValidElement(el));
      assertEquals((el as any).type, "section");
      assertEquals(((el as any).props.children as any).type, "span");
    });

    it("supports ESM format with exports", async () => {
      const compiled = `
      import { jsx } from "react/jsx-runtime";
      export function MDXContent(){
        return jsx('p', { children: 'foo' });
      }
    `;
      const mod = await mdxRenderer.loadModuleESM(compiled);
      const Component = mod.MDXContent as () => React.ReactElement;
      const el = Component(); // Call the component function
      assert(React.isValidElement(el));
      assertEquals((el as any).type, "p");
      assertEquals((el as any).props.children, "foo");
    });

    it("handles errors gracefully with ESM loader", async () => {
      const compiled = `
      import { jsx } from "react/jsx-runtime";
      export function MDXContent(){ throw new Error('boom'); }
    `;
      const mod = await mdxRenderer.loadModuleESM(compiled);
      const Component = mod.MDXContent as () => React.ReactElement;
      try {
        Component(); // Call the component - should throw
        assert(false, "Should have thrown");
      } catch (err) {
        assertEquals((err as Error).message, "boom");
      }
    });

    it("handles frontmatter extraction", async () => {
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

    it("renders with custom components", async () => {
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
      const el = Component({ components: { h1: customH1 } }); // Call with props
      assert(React.isValidElement(el));
      // Check that custom component was used
      assertEquals(typeof (el as any).type, "function"); // Type is the custom component
      assertEquals((el as any).props.children, "Heading"); // Props passed correctly
      // Call the custom component to verify it renders 'header'
      const rendered = (el as any).type((el as any).props);
      assertEquals((rendered as any).type, "header");
    });

    it("handles MDX without external imports", async () => {
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
      const el = Component(); // Call the component
      assert(React.isValidElement(el));
      assertEquals((el as any).type, "div");
    });

    it("renders nested MDX elements", async () => {
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
      const el = Component(); // Call the component
      assert(React.isValidElement(el));
      assertEquals((el as any).type, "article");
    });

    it("handles MDX with expressions", async () => {
      const compiled = `
      import { jsx } from "react/jsx-runtime";
      export function MDXContent(){
        const value = 42;
        return jsx("div", { children: \`The answer is \${value}\` });
      }
    `;
      const mod = await mdxRenderer.loadModuleESM(compiled);
      const Component = mod.MDXContent as () => React.ReactElement;
      const el = Component(); // Call the component
      assert(React.isValidElement(el));
      assertEquals((el as any).props.children, "The answer is 42");
    });
  },
);

describe(
  "MDX ESM loader",
  () => {
    it("loads simple module and caches", async () => {
      const code = `
      export const title = "T";
      export const MDXLayout = ({ children }) => jsx('div', { children });
      export function MDXContent(){ return jsx('p', { children: 'ok' }); }
    `;
      const mod1 = await mdxRenderer.loadModuleESM(code);
      assertEquals(typeof mod1.title, "string");
      assert(mod1.MDXLayout || (mod1 as any).__vfLayout !== undefined);
      const mod2 = await mdxRenderer.loadModuleESM(code);
      // Cached instance equality by object identity
      assert(mod1 === mod2);
    });

    it("loads module with exports", async () => {
      const code = `
      export const metadata = { title: "Test", slug: "test-page" };
      export const config = { layout: "default" };
      export function MDXContent(){ return jsx('div', { children: 'content' }); }
    `;
      const mod = await mdxRenderer.loadModuleESM(code);
      assert((mod as any).metadata);
      assert((mod as any).config);
    });

    it("handles module with default export", async () => {
      const code = `
      export default function DefaultComponent() {
        return jsx('main', { children: 'Default' });
      }
      export const MDXContent = DefaultComponent;
    `;
      const mod = await mdxRenderer.loadModuleESM(code);
      assert(mod.default || mod.MDXContent);
    });

    it("caches modules by code content", async () => {
      const code1 = `export function MDXContent(){ return jsx('p', { children: '1' }); }`;
      const code2 = `export function MDXContent(){ return jsx('p', { children: '2' }); }`;

      const mod1 = await mdxRenderer.loadModuleESM(code1);
      const mod2 = await mdxRenderer.loadModuleESM(code2);
      const mod1Again = await mdxRenderer.loadModuleESM(code1);

      // Same code should return cached module
      assert(mod1 === mod1Again);
      // Different code should return different module
      assert(mod1 !== mod2);
    });

    it("loads complex module with multiple exports", async () => {
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
  },
);
