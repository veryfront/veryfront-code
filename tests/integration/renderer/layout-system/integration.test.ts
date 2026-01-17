/**
 * Integration tests for the complete layout system
 * Tests nested layouts, providers, and App Router reserved components
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import {
  assertEquals as _assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { afterAll, describe, it } from "@std/testing/bdd";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";

describe("Layout System Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up bundler intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  it("nested layouts with App Router", async () => {
    await withTestContext("layout-nested-app-router", async (context) => {
      // Create App Router structure with nested layouts
      await Deno.mkdir(join(context.projectDir, "app/blog"), { recursive: true });

      // Root layout
      await Deno.writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      // Blog layout
      await Deno.writeTextFile(
        join(context.projectDir, "app/blog/layout.tsx"),
        `export default function BlogLayout({ children }) {
  return <div id="blog-layout">{children}</div>;
}`,
      );

      // Page
      await Deno.writeTextFile(
        join(context.projectDir, "app/blog/page.mdx"),
        `---
title: Blog Post
---

# My Blog Post

This is a test post.
`,
      );

      // Config
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      const adapter = new DenoAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("blog");

      assertExists(result.html);
      assertStringIncludes(result.html, "My Blog Post");

      // Clean up
      await renderer.destroy();
    });
  });

  it("named layout with providers", async () => {
    await withTestContext("layout-named-providers", async (context) => {
      // Create named layout
      await Deno.mkdir(join(context.projectDir, "layouts"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "layouts/main.mdx"),
        `# Main Layout

<slot />`,
      );

      // Create provider
      await Deno.mkdir(join(context.projectDir, "providers"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "providers/theme.mdx"),
        `export default function ThemeProvider({ children }) {
  return <div className="theme-provider">{children}</div>;
}`,
      );

      // Create page with layout
      await Deno.writeTextFile(
        join(context.projectDir, "pages/test.mdx"),
        `---
title: Test Page
layout: main
---

# Test Content
`,
      );

      const adapter = new DenoAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("test");

      assertExists(result.html);
      assertStringIncludes(result.html, "Test Content");

      // Clean up
      await renderer.destroy();
    });
  });

  it("App Router reserved components", async () => {
    await withTestContext("layout-reserved-components", async (context) => {
      // Create App Router structure
      await Deno.mkdir(join(context.projectDir, "app/products"), { recursive: true });

      // Loading component
      await Deno.writeTextFile(
        join(context.projectDir, "app/products/loading.tsx"),
        `export default function Loading() {
  return <div>Loading products...</div>;
}`,
      );

      // Error component
      await Deno.writeTextFile(
        join(context.projectDir, "app/products/error.tsx"),
        `export default function Error({ error }) {
  return <div>Error: {error?.message}</div>;
}`,
      );

      // Page
      await Deno.writeTextFile(
        join(context.projectDir, "app/products/page.mdx"),
        `---
title: Products
---

# Products Page
`,
      );

      // Config
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      const adapter = new DenoAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("products");

      assertExists(result.html);
      assertStringIncludes(result.html, "Products Page");

      // Clean up
      await renderer.destroy();
    });
  });

  it("Pages Router with App component", async () => {
    await withTestContext("layout-pages-router-app", async (context) => {
      // Create App component
      await Deno.writeTextFile(
        join(context.projectDir, "components/app.tsx"),
        `export default function App({ children }) {
  return (
    <div id="app-wrapper">
      <header>Header</header>
      <main>{children}</main>
      <footer>Footer</footer>
    </div>
  );
}`,
      );

      // Create page
      await Deno.writeTextFile(
        join(context.projectDir, "pages/index.mdx"),
        `---
title: Home
---

# Welcome Home
`,
      );

      const adapter = new DenoAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("/");

      assertExists(result.html);
      assertStringIncludes(result.html, "Welcome Home");

      // Clean up
      await renderer.destroy();
    });
  });
});
