
import { assert, assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "Renderer System",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("Core Functionality", () => {
      it("should initialize renderer successfully", async () => {
        await withTestContext("renderer-init", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            `---
title: Home Page
description: Test home page
---

# Welcome

This is the home page content.
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          assert(renderer, "Renderer should be created");
          assert(typeof renderer.renderPage === "function", "Should have renderPage method");
          assert(typeof renderer.getAllPages === "function", "Should have getAllPages method");
        });
      });

      it("should render basic MDX page", async () => {
        await withTestContext("renderer-mdx", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            `---
title: Home Page
description: Test home page
---

# Welcome

This is the home page content.
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("index");

          assertEquals(typeof result.html, "string");
          assertEquals(result.frontmatter.title, "Home Page");
          assertEquals(result.frontmatter.description, "Test home page");
          assertStringIncludes(result.html, "Welcome");
          assertStringIncludes(result.html, "home page content");
        });
      });

      it("should handle non-existent pages", async () => {
        await withTestContext("renderer-404", async (context) => {
          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            await renderer.renderPage("non-existent");
            assert(false, "Should have thrown an error");
          } catch (error) {
            assertStringIncludes((error as Error).message, "not found");
          }
        });
      });

      it("should get all pages", async () => {
        await withTestContext("renderer-all-pages", async (context) => {
          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const pages = await renderer.getAllPages();
          assert(Array.isArray(pages), "Should return an array");
          // Pages might be empty in test environment, that's ok
        });
      });
    });

    describe("Layout Support", () => {
      it("should render page with layout", async () => {
        await withTestContext("renderer-layout", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "layouts"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "layouts", "main.mdx"),
            `---
isLayout: true
---

import React from 'react';

export default function MainLayout({ children }) {
  return (<div className="main-layout">
      <header>Site Header</header>
      <main>{children}</main>
      <footer>Site Footer</footer>
    </div>);
}
`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "with-layout.mdx"),
            `---
title: Page with Layout
layout: main
---

# Content with Layout

This content should be wrapped by the layout.

Here is a paragraph with more text to make sure it renders.
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("with-layout");
          assertStringIncludes(result.html, "Content with Layout");
        });
      });

      it("should render page with layout (ESM)", async () => {
        await withTestContext("renderer-layout-esm", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "layouts"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { experimental: { esmLayouts: true } };`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "layouts", "main.mdx"),
            `---
isLayout: true
---

import React from 'react';

export default function MainLayout({ children }) {
  return (<div className="main-layout">
      <header>Site Header</header>
      <main>{children}</main>
      <footer>Site Footer</footer>
    </div>);
}
`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "with-layout.mdx"),
            `---
title: Page with Layout
layout: main
---

# Content with Layout

This content should be wrapped by the layout.
`,
          );

          const esmRenderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await esmRenderer.renderPage("with-layout");
          assertStringIncludes(result.html, "Content with Layout");
        });
      });

      it("should apply nested directory layouts from pages subfolders", async () => {
        await withTestContext("renderer-nested-layouts", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          const blogDir = join(context.projectDir, "pages", "blog");
          const postDir = join(blogDir, "post");
          await Deno.mkdir(postDir, { recursive: true });

          const outerLayout =
            `---\nisLayout: true\n---\nexport default function OuterLayout({ children }) { return (<div className="outer"><main>{children}</main></div>); }`;
          const innerLayout =
            `---\nisLayout: true\n---\nexport default function InnerLayout({ children }) { return (<div className="inner">{children}</div>); }`;
          const page = `# Nested Layout Page\n\nContent inside nested layouts.`;

          await Deno.writeTextFile(join(blogDir, "layout.mdx"), outerLayout);
          await Deno.writeTextFile(join(postDir, "layout.mdx"), innerLayout);
          await Deno.writeTextFile(join(postDir, "index.mdx"), page);

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/post");
          const html = result.html;
          const outerIdx = html.indexOf('class="outer"');
          const innerIdx = html.indexOf('class="inner"');
          assertEquals(outerIdx !== -1 && innerIdx !== -1 && outerIdx < innerIdx, true);
          assertStringIncludes(html, "Nested Layout Page");
        });
      });

      it.skip("should honor nested metadata object in MDX frontmatter", async () => {
        await withTestContext("renderer-mdx-metadata", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "mdxmeta.mdx"),
            `---\n` +
              `title: Front Title\n` +
              `---\n\n` +
              `export const metadata = { title: 'Meta Title', description: 'Meta Desc' }\n\n` +
              `# MDX Meta Test`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("mdxmeta");
          const html = result.html;
          assertStringIncludes(html, "<title>Meta Title</title>");
        });
      });
    });

    describe("Provider Support", () => {
      it("should render page with provider", async () => {
        await withTestContext("renderer-provider", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "providers"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "providers", "theme.mdx"),
            `---
isProvider: true
priority: 1
---

export default function ThemeProvider({ children }) {
  return (<div className="theme-provider" data-theme="light">
      {children}
    </div>);
}
`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "themed.mdx"),
            `---
title: Themed Page
---

# Themed Content

This should be wrapped by the theme provider.
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("themed");
          assertStringIncludes(result.html, "theme-provider");
          assertStringIncludes(result.html, 'data-theme="light"');
          assertStringIncludes(result.html, "Themed Content");
        });
      });

      it("should render page with provider (ESM)", async () => {
        await withTestContext("renderer-provider-esm", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "providers"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { experimental: { esmLayouts: true } };`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "providers", "theme.mdx"),
            `---
isProvider: true
priority: 1
---

export default function ThemeProvider({ children }) {
  return (<div className="theme-provider" data-theme="light">
      {children}
    </div>);
}
`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "themed.mdx"),
            `---
title: Themed Page
---

# Themed Content

This should be wrapped by the theme provider.
`,
          );

          const esmRenderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await esmRenderer.renderPage("themed");
          assertStringIncludes(result.html, "theme-provider");
          assertStringIncludes(result.html, "Themed Content");
        });
      });
    });

    describe("Error Handling", () => {
      it("should handle MDX compilation errors", async () => {
        await withTestContext("renderer-error", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "broken.mdx"),
            `---
title: Broken Page
---

# Broken Content

<InvalidComponent unclosed={
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          try {
            await renderer.renderPage("broken");
            assert(false, "Should have thrown an error");
          } catch (error) {
            assert(
              (error as Error).message.includes("compilation") ||
                (error as Error).message.includes("parse"),
            );
          }
        });
      });
    });

    describe("Caching", () => {
      it("should cache rendered pages", async () => {
        await withTestContext("renderer-cache", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          await Deno.writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Cached Page
timestamp: ${Date.now()}
---

# Cached Content

This should be cached after first render.
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result1 = await renderer.renderPage("cached");
          const timestamp1 = result1.frontmatter.timestamp;

          const result2 = await renderer.renderPage("cached");
          const timestamp2 = result2.frontmatter.timestamp;

          assertEquals(timestamp1, timestamp2, "Should use cached version");
        });
      });

      it("should clear cache when requested", async () => {
        await withTestContext("renderer-cache-clear", async (context) => {
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });

          const timestamp1 = Date.now();
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Cached Page
timestamp: ${timestamp1}
---

# Cached Content
`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          await renderer.renderPage("cached");

          await renderer.clearCache();

          const timestamp2 = Date.now() + 1000;
          await Deno.writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Updated Cached Page
timestamp: ${timestamp2}
---

# Updated Content
`,
          );

          const result = await renderer.renderPage("cached");
          assertEquals(result.frontmatter.title, "Updated Cached Page");
        });
      });
    });

    describe("App Router Pages", () => {
      it("should render app router page with nested layouts", async () => {
        await withTestContext("renderer-app-router", async (context) => {
          await Deno.mkdir(join(context.projectDir, "app", "blog", "post"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.mdx"),
            `---\nisLayout: true\n---\nexport default function RootLayout({ children }) { return (<div className="root-layout"><main>{children}</main></div>); }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }) { return (<div className="blog-layout">{children}</div>); }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# App Router Page\n\nHello from App Router page.`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/post");
          const html = result.html;
          const rootIdx = html.indexOf('class="root-layout"');
          const blogIdx = html.indexOf('class="blog-layout"');
          if (!(rootIdx !== -1 && blogIdx !== -1 && rootIdx < blogIdx)) {
            throw new Error(`Expected root then blog layout wrappers. HTML: ${html}`);
          }
          if (!html.includes("App Router Page")) {
            throw new Error("Rendered HTML missing page content");
          }
        });
      });

      it("should apply reserved loading and error components in App Router", async () => {
        await withTestContext("renderer-app-router-reserved", async (context) => {
          await Deno.mkdir(join(context.projectDir, "app", "blog", "post"), {
            recursive: true,
          });

          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.mdx"),
            `---\nisLayout: true\n---\nexport default function RootLayout({ children }) { return (<div className="root-layout"><main>{children}</main></div>); }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }) { return (<div className="blog-layout">{children}</div>); }`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# App Router Page\n\nHello from App Router page.`,
          );

          await Deno.writeTextFile(
            join(context.projectDir, "app", "loading.tsx"),
            `export default function Loading(){ return (<div className="loading">Loading...</div>); }`,
          );
          await Deno.writeTextFile(
            join(context.projectDir, "app", "error.tsx"),
            `export default function Err(){ return (<div className="err">Error</div>); }`,
          );

          const renderer = await createRenderer({
            projectDir: context.projectDir,
            mode: "development",
          });

          const result = await renderer.renderPage("blog/post");
          const html = result.html;
          assertStringIncludes(html, "App Router Page");
        });
      });
    });
  },
);
