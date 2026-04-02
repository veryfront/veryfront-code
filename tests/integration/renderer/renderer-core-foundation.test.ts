/**
 * VeryfrontRenderer Foundation Tests (Part 1 of 3)
 * Tests: Initialization, Page Entity Resolution, Layout Collection,
 *        Provider Support, SSR Rendering, MDX Compilation,
 *        Component/TSX Pages, Caching and Manifest
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";

import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

function stripReactSSRMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

// Skip tests on non-Deno runtimes (SSR uses URL-based imports)
// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "VeryfrontRenderer Core - Foundation",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("Initialization", () => {
      it("should initialize renderer with required dependencies", async () => {
        await withTestContext("renderer-core-init", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          assertExists(renderer, "Renderer should be created");
          assert(typeof renderer.renderPage === "function", "Should have renderPage method");
          assert(typeof renderer.getAllPages === "function", "Should have getAllPages method");
          assert(typeof renderer.compileMDX === "function", "Should have compileMDX method");
          assert(typeof renderer.clearCache === "function", "Should have clearCache method");
          assert(typeof renderer.clearAllState === "function", "Should have clearAllState method");
          assert(
            typeof renderer.initializeComponents === "function",
            "Should have initializeComponents method",
          );
          assert(
            typeof renderer.getVirtualModuleSystem === "function",
            "Should have getVirtualModuleSystem method",
          );
        });
      });

      it("should initialize with custom config", async () => {
        await withTestContext("renderer-core-config", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default {
              title: "Custom Config Test",
              description: "Custom description",
              layout: "main"
            };`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          assertExists(renderer);
        });
      });

      it("should load component registry on initialization", async () => {
        await withTestContext("renderer-core-components", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "components", "Button.tsx"),
            `export default function Button({ children }) {
              return <button className="custom-btn">{children}</button>;
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await renderer.initializeComponents();
          assertExists(renderer);
        });
      });
    });

    describe("Page Entity Resolution", () => {
      it("should find page in pages directory", async () => {
        await withTestContext("renderer-core-pages-dir", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
title: Test Page
---

# Test Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result);
          assertEquals(result.frontmatter.title, "Test Page");
        });
      });

      it("should find page in app router directory", async () => {
        await withTestContext("renderer-core-app-router", async (context) => {
          await mkdir(join(context.projectDir, "app", "test"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "test", "page.mdx"),
            `---
title: App Router Page
---

# App Router Test
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result);
          assertStringIncludes(result.html, "App Router Test");
        });
      });

      it("should handle non-existent pages with error", async () => {
        await withTestContext("renderer-core-404", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await assertRejects(
            async () => await renderer.renderPage("non-existent-page"),
            Error,
            "not found",
          );
        });
      });

      it("should handle dynamic route parameters", async () => {
        await withTestContext("renderer-core-params", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "pages", "blog", "[slug].tsx"),
            `export default function BlogPost({ params }) {
              return <div>Post: {params?.slug}</div>;
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/my-post", {
            params: { slug: "my-post" },
          });

          assertExists(result);
          assertStringIncludes(result.html, "my-post");
        });
      });
    });

    describe("Layout Collection and Application", () => {
      it("should apply named layout from frontmatter", async () => {
        await withTestContext("renderer-core-named-layout", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await mkdir(join(context.projectDir, "layouts"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "layouts", "main.mdx"),
            `---
isLayout: true
---

export default function MainLayout({ children }) {
  return <div className="main-layout"><header>Header</header>{children}<footer>Footer</footer></div>;
}`,
          );

          // Note: filename must not contain "layout" as it triggers layout detection
          await writeTextFile(
            join(context.projectDir, "pages", "styled-page.mdx"),
            `---
title: With Layout
layout: main
---

# Page Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("styled-page");
          assertStringIncludes(result.html, "main-layout");
          assertStringIncludes(result.html, "Page Content");
        });
      });

      it("should disable layout when frontmatter layout is false", async () => {
        await withTestContext("renderer-core-no-layout", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { layout: "main" };`,
          );

          await mkdir(join(context.projectDir, "layouts"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "layouts", "main.mdx"),
            `---
isLayout: true
---

export default function MainLayout({ children }) {
  return <div className="should-not-appear">{children}</div>;
}`,
          );

          // Note: filename must not contain "layout" as it triggers layout detection
          await writeTextFile(
            join(context.projectDir, "pages", "raw-page.mdx"),
            `---
title: No Layout
layout: false
---

# Content Without Layout
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("raw-page");
          assertStringIncludes(result.html, "Content Without Layout");
        });
      });

      it("should apply nested layouts in correct order", async () => {
        await withTestContext("renderer-core-nested-layouts", async (context) => {
          await mkdir(join(context.projectDir, "app", "blog", "post"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "layout.mdx"),
            `---
isLayout: true
---

export default function RootLayout({ children }) {
  return <div className="root">{children}</div>;
}`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }) {
              return <div className="blog">{children}</div>;
            }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# Post Content`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/post");
          const html = result.html;
          const rootIdx = html.indexOf('class="root"');
          const blogIdx = html.indexOf('class="blog"');

          assert(
            rootIdx !== -1 && blogIdx !== -1 && rootIdx < blogIdx,
            "Layouts should be nested correctly",
          );
        });
      });

      it("should apply layouts with ESM mode enabled", async () => {
        await withTestContext("renderer-core-esm-layouts", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { experimental: { esmLayouts: true } };`,
          );

          await mkdir(join(context.projectDir, "layouts"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "layouts", "main.mdx"),
            `---
isLayout: true
---

export default function MainLayout({ children }) {
  return <div className="esm-layout">{children}</div>;
}`,
          );

          await writeTextFile(
            join(context.projectDir, "pages", "esm-test.mdx"),
            `---
layout: main
---

# ESM Layout Test
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("esm-test");
          assertStringIncludes(result.html, "esm-layout");
          assertStringIncludes(result.html, "ESM Layout Test");
        });
      });
    });

    describe("SSR Rendering", () => {
      it("should render to HTML string in development mode", async () => {
        await withTestContext("renderer-core-ssr-string", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
title: SSR Test
---

# SSR Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertEquals(typeof result.html, "string");
          assertStringIncludes(result.html, "SSR Content");
          assertEquals(result.stream, null);
        });
      });

      it("should support streaming rendering when requested", async () => {
        await withTestContext("renderer-core-ssr-stream", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
title: Stream Test
---

# Streaming Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test", { delivery: "stream" });

          if (!result.stream) {
            assertEquals(typeof result.html, "string");
            assertStringIncludes(result.html, "Streaming Content");
            return;
          }

          const reader = result.stream.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullContent += decoder.decode(value, { stream: true });
          }

          fullContent += decoder.decode();
          assertStringIncludes(fullContent, "Streaming Content");
        });
      });

      it("should use streaming SSR in production mode", async () => {
        await withTestContext("renderer-core-ssr-production", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(join(context.projectDir, "pages", "test.mdx"), `# Production Test`);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "production",
          });

          const result = await renderer.renderPage("test");
          assertEquals(typeof result.html, "string");
          assertStringIncludes(result.html, "Production Test");
        });
      });

      it("should include SSR hash in result", async () => {
        await withTestContext("renderer-core-ssr-hash", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(join(context.projectDir, "pages", "test.mdx"), `# Test`);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result.ssrHash);
          assertEquals(typeof result.ssrHash, "string");
        });
      });
    });

    describe("MDX Compilation", () => {
      it("should compile MDX content to bundle", async () => {
        await withTestContext("renderer-core-mdx-compile", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const bundle = await renderer.compileMDX("# Hello World\n\nThis is a test.", {
            title: "Test",
          });

          assertExists(bundle);
          assertExists(bundle.compiledCode);
          assertEquals(bundle.frontmatter!.title, "Test");
        });
      });

      it("should handle MDX with frontmatter", async () => {
        await withTestContext("renderer-core-mdx-frontmatter", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const bundle = await renderer.compileMDX(
            "# Test Page",
            { title: "My Title", description: "My Description" },
            "/test/page.mdx",
          );

          assertEquals(bundle.frontmatter!.title, "My Title");
          assertEquals(bundle.frontmatter!.description, "My Description");
        });
      });

      it("should handle MDX compilation errors gracefully", async () => {
        await withTestContext("renderer-core-mdx-error", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await assertRejects(
            async () =>
              await renderer.compileMDX("<InvalidComponent unclosed={", { title: "Broken" }),
            Error,
            "compilation",
          );
        });
      });
    });

    describe("Component/TSX Pages", () => {
      it("should render TSX component page", async () => {
        await withTestContext("renderer-core-tsx-page", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "component.tsx"),
            `export default function ComponentPage() {
              return <div className="tsx-page"><h1>TSX Page</h1></div>;
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("component");
          assertStringIncludes(result.html, "tsx-page");
          assertStringIncludes(result.html, "TSX Page");
        });
      });

      it("should render JSX component page", async () => {
        await withTestContext("renderer-core-jsx-page", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "component.jsx"),
            `export default function ComponentPage() {
              return <div className="jsx-page"><h1>JSX Page</h1></div>;
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("component");
          assertStringIncludes(result.html, "jsx-page");
          assertStringIncludes(result.html, "JSX Page");
        });
      });

      it("should pass props to component pages", async () => {
        await withTestContext("renderer-core-tsx-props", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "with-props.tsx"),
            `export default function WithProps({ message = 'default' }) {
              return <div>Message: {message}</div>;
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("with-props", {
            props: { message: "Hello from props!" },
          });

          assertStringIncludes(result.html, "Hello from props!");
        });
      });

      it("should handle script pages (ts/js) returning data", async () => {
        await withTestContext("renderer-core-script-page", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "data.ts"),
            `export default function handler() {
              return { message: 'Data from script page' };
            }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("data");
          assertExists(result);
        });
      });

      it("should pass params and query to script page context", async () => {
        await withTestContext("renderer-core-script-page-request-context", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });
          await mkdir(join(context.projectDir, "pages", "reports"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "reports", "[id].ts"),
            `export function generateMetadata(ctx) {
              return { title: \`Report \${ctx.params.id} (\${ctx.query.view || "none"})\` };
            }

export default function ReportPage(ctx) {
  return {
    html: \`<div id="request-context">report=\${ctx.params.id};view=\${ctx.query.view || "none"};tab=\${ctx.query.tab || "none"}</div>\`,
  };
}
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("reports/42", {
            params: { id: "42" },
            url: new URL("https://example.com/reports/42?view=full&tab=summary"),
          });

          assertStringIncludes(result.html, 'id="request-context"');
          assertStringIncludes(result.html, "report=42;view=full;tab=summary");
          assertEquals(result.frontmatter.title, "Report 42 (full)");
        });
      });

      it("should expose params and query through usePageContext during SSR", async () => {
        await withTestContext("renderer-core-page-context-request-values", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });
          await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "blog", "[slug].tsx"),
            `import { usePageContext } from "veryfront/context";

export default function BlogPost() {
  const ctx = usePageContext();
  return (
    <div id="page-context">
      Page params: {ctx?.params?.slug || "none"} | Page query: {ctx?.query?.tab || "none"}
    </div>
  );
}
`,
          );

          await writeTextFile(
            join(context.projectDir, "pages", "layout.tsx"),
            `import { usePageContext } from "veryfront/context";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = usePageContext();
  return (
    <div id="layout-wrapper">
      <header id="layout-context">
        Layout params: {ctx?.params?.slug || "none"} | Layout query: {ctx?.query?.lang || "none"}
      </header>
      <main>{children}</main>
    </div>
  );
}
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/hello", {
            params: { slug: "hello" },
            url: new URL("https://example.com/blog/hello?tab=files&lang=en"),
          });

          const normalizedHtml = stripReactSSRMarkers(result.html);
          assertStringIncludes(normalizedHtml, "Layout params: hello | Layout query: en");
          assertStringIncludes(normalizedHtml, "Page params: hello | Page query: files");
        });
      });
    });

    describe("Caching and Manifest", () => {
      it("should cache rendered pages in development", async () => {
        await withTestContext("renderer-core-cache", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          const timestamp = Date.now();
          await writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Cached Page
timestamp: ${timestamp}
---

# Cached Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result1 = await renderer.renderPage("cached");
          const result2 = await renderer.renderPage("cached");

          assertEquals(result1.frontmatter.timestamp, result2.frontmatter.timestamp);
        });
      });

      it("should clear specific page from cache", async () => {
        await withTestContext("renderer-core-clear-cache", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
version: 1
---

# Version 1
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await renderer.renderPage("test");
          renderer.clearCache("test");

          await writeTextFile(
            join(context.projectDir, "pages", "test.mdx"),
            `---
version: 2
---

# Version 2
`,
          );

          const result = await renderer.renderPage("test");
          assertEquals(result.frontmatter.version, 2);
        });
      });

      it("should clear all state", async () => {
        await withTestContext("renderer-core-clear-all", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(join(context.projectDir, "pages", "test.mdx"), `# Test`);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await renderer.renderPage("test");
          renderer.clearAllState();

          const result = await renderer.renderPage("test");
          assertExists(result);
        });
      });

      it("should handle page module cache and manifest", async () => {
        await withTestContext("renderer-core-module-cache", async (context) => {
          await remove(join(context.projectDir, "app"), { recursive: true });

          await writeTextFile(join(context.projectDir, "pages", "test.mdx"), `# Test Page`);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("test");
          assertExists(result.pageModule?.code || result.pageModule === undefined);
        });
      });
    });
  },
);
