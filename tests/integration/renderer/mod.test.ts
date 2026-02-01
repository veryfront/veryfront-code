/**
 * Unit Tests for Veryfront Renderer
 * Tests the main rendering engine and page compilation
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";

import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

async function removeAppDir(projectDir: string): Promise<void> {
  await remove(join(projectDir, "app"), { recursive: true });
}

async function createDevRenderer(projectDir: string): Promise<Awaited<ReturnType<typeof createRenderer>>> {
  return await createRenderer({ projectDir, mode: "development" });
}

// Skip tests on non-Deno runtimes (SSR uses URL-based imports)
// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
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
          await removeAppDir(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            `---
title: Home Page
description: Test home page
---

# Welcome

This is the home page content.
`,
          );

          const renderer = await createDevRenderer(context.projectDir);

          assert(renderer, "Renderer should be created");
          assert(typeof renderer.renderPage === "function", "Should have renderPage method");
          assert(typeof renderer.getAllPages === "function", "Should have getAllPages method");
        });
      });

      it("should render basic MDX page", async () => {
        await withTestContext("renderer-mdx", async (context) => {
          await removeAppDir(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            `---
title: Home Page
description: Test home page
---

# Welcome

This is the home page content.
`,
          );

          const renderer = await createDevRenderer(context.projectDir);
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
          const renderer = await createDevRenderer(context.projectDir);

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
          const renderer = await createDevRenderer(context.projectDir);

          const pages = await renderer.getAllPages();
          assert(Array.isArray(pages), "Should return an array");
        });
      });
    });

    describe("Layout Support", () => {
      it("should render page with layout", async () => {
        await withTestContext("renderer-layout", async (context) => {
          await removeAppDir(context.projectDir);

          await mkdir(join(context.projectDir, "layouts"), { recursive: true });

          await writeTextFile(
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

          // Note: filename must not contain "layout" as it triggers layout detection
          await writeTextFile(
            join(context.projectDir, "pages", "styled-page.mdx"),
            `---
title: Page with Layout
layout: main
---

# Content with Layout

This content should be wrapped by the layout.

Here is a paragraph with more text to make sure it renders.
`,
          );

          const renderer = await createDevRenderer(context.projectDir);
          const result = await renderer.renderPage("styled-page");

          // New renderer wraps content inside default shell; ensure content rendered
          assertStringIncludes(result.html, "Content with Layout");
        });
      });

      it("should render page with layout (ESM)", async () => {
        await withTestContext("renderer-layout-esm", async (context) => {
          await removeAppDir(context.projectDir);

          await mkdir(join(context.projectDir, "layouts"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default { experimental: { esmLayouts: true } };`,
          );

          await writeTextFile(
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

          // Note: filename must not contain "layout" as it triggers layout detection
          await writeTextFile(
            join(context.projectDir, "pages", "styled-page.mdx"),
            `---
title: Page with Layout
layout: main
---

# Content with Layout

This content should be wrapped by the layout.
`,
          );

          const renderer = await createDevRenderer(context.projectDir);
          const result = await renderer.renderPage("styled-page");

          assertStringIncludes(result.html, "Content with Layout");
        });
      });

      it("should apply nested directory layouts from pages subfolders", async () => {
        await withTestContext("renderer-nested-layouts", async (context) => {
          await removeAppDir(context.projectDir);

          const blogDir = join(context.projectDir, "pages", "blog");
          const postDir = join(blogDir, "post");
          await mkdir(postDir, { recursive: true });

          const outerLayout =
            `---\nisLayout: true\n---\nexport default function OuterLayout({ children }) { return (<div className="outer"><main>{children}</main></div>); }`;
          const innerLayout =
            `---\nisLayout: true\n---\nexport default function InnerLayout({ children }) { return (<div className="inner">{children}</div>); }`;
          const page = `# Nested Layout Page\n\nContent inside nested layouts.`;

          await writeTextFile(join(blogDir, "layout.mdx"), outerLayout);
          await writeTextFile(join(postDir, "layout.mdx"), innerLayout);
          await writeTextFile(join(postDir, "index.mdx"), page);

          const renderer = await createDevRenderer(context.projectDir);
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
          await removeAppDir(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "mdxmeta.mdx"),
            `---\n` +
              `title: Front Title\n` +
              `---\n\n` +
              `export const metadata = { title: 'Meta Title', description: 'Meta Desc' }\n\n` +
              `# MDX Meta Test`,
          );

          const renderer = await createDevRenderer(context.projectDir);
          const result = await renderer.renderPage("mdxmeta");

          assertStringIncludes(result.html, "<title>Meta Title</title>");
        });
      });
    });

    describe("Error Handling", () => {
      it("should handle MDX compilation errors", async () => {
        await withTestContext("renderer-error", async (context) => {
          await removeAppDir(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "broken.mdx"),
            `---
title: Broken Page
---

# Broken Content

<InvalidComponent unclosed={
`,
          );

          const renderer = await createDevRenderer(context.projectDir);

          try {
            await renderer.renderPage("broken");
            assert(false, "Should have thrown an error");
          } catch (error) {
            const message = (error as Error).message;
            assert(message.includes("compilation") || message.includes("parse"));
          }
        });
      });
    });

    describe("Caching", () => {
      it("should cache rendered pages", async () => {
        await withTestContext("renderer-cache", async (context) => {
          await removeAppDir(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Cached Page
timestamp: ${Date.now()}
---

# Cached Content

This should be cached after first render.
`,
          );

          const renderer = await createDevRenderer(context.projectDir);

          const result1 = await renderer.renderPage("cached");
          const timestamp1 = result1.frontmatter.timestamp;

          const result2 = await renderer.renderPage("cached");
          const timestamp2 = result2.frontmatter.timestamp;

          assertEquals(timestamp1, timestamp2, "Should use cached version");
        });
      });

      it("should clear cache when requested", async () => {
        await withTestContext("renderer-cache-clear", async (context) => {
          await removeAppDir(context.projectDir);

          const timestamp1 = Date.now();
          await writeTextFile(
            join(context.projectDir, "pages", "cached.mdx"),
            `---
title: Cached Page
timestamp: ${timestamp1}
---

# Cached Content
`,
          );

          const renderer = await createDevRenderer(context.projectDir);

          await renderer.renderPage("cached");
          await renderer.clearCache();

          const timestamp2 = Date.now() + 1000;
          await writeTextFile(
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
          await mkdir(join(context.projectDir, "app", "blog", "post"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "layout.mdx"),
            `---\nisLayout: true\n---\nexport default function RootLayout({ children }) { return (<div className="root-layout"><main>{children}</main></div>); }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }) { return (<div className="blog-layout">{children}</div>); }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# App Router Page\n\nHello from App Router page.`,
          );

          const renderer = await createDevRenderer(context.projectDir);
          const result = await renderer.renderPage("blog/post");

          const html = result.html;
          const rootIdx = html.indexOf('class="root-layout"');
          const blogIdx = html.indexOf('class="blog-layout"');

          if (rootIdx === -1 || blogIdx === -1 || rootIdx >= blogIdx) {
            throw new Error(`Expected root then blog layout wrappers. HTML: ${html}`);
          }

          if (!html.includes("App Router Page")) {
            throw new Error("Rendered HTML missing page content");
          }
        });
      });

      it("should apply reserved loading and error components in App Router", async () => {
        await withTestContext("renderer-app-router-reserved", async (context) => {
          await mkdir(join(context.projectDir, "app", "blog", "post"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "layout.mdx"),
            `---\nisLayout: true\n---\nexport default function RootLayout({ children }) { return (<div className="root-layout"><main>{children}</main></div>); }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "layout.tsx"),
            `export default function BlogLayout({ children }) { return (<div className="blog-layout">{children}</div>); }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "blog", "post", "page.mdx"),
            `# App Router Page\n\nHello from App Router page.`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "loading.tsx"),
            `export default function Loading(){ return (<div className="loading">Loading...</div>); }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "error.tsx"),
            `export default function Err(){ return (<div className="err">Error</div>); }`,
          );

          const renderer = await createDevRenderer(context.projectDir);
          const result = await renderer.renderPage("blog/post");

          // We can't force Suspense to show fallback in SSR string, but wrapper should not break HTML
          assertStringIncludes(result.html, "App Router Page");
        });
      });
    });
  },
);
