/**
 * Integration tests for the complete layout system
 * Tests nested layouts, providers, and App Router reserved components
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertExists, assertStringIncludes } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../_helpers/context.ts";

async function createRenderer(projectDir: string): Promise<VeryfrontRenderer> {
  const adapter = await getAdapter();
  const renderer = new VeryfrontRenderer({
    projectDir,
    mode: "development",
    adapter,
  });

  await renderer.initialize();
  return renderer;
}

async function withRenderer(
  projectDir: string,
  fn: (renderer: VeryfrontRenderer) => Promise<void>,
): Promise<void> {
  const renderer = await createRenderer(projectDir);
  try {
    await fn(renderer);
  } finally {
    await renderer.destroy();
  }
}

describe("Layout System Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("nested layouts with App Router", async () => {
    await withTestContext("layout-nested-app-router", async (context) => {
      await mkdir(join(context.projectDir, "app/blog"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/blog/layout.tsx"),
        `export default function BlogLayout({ children }) {
  return <div id="blog-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/blog/page.mdx"),
        `---
title: Blog Post
---

# My Blog Post

This is a test post.
`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("blog");
        assertExists(result.html);
        assertStringIncludes(result.html, "My Blog Post");
      });
    });
  });

  it("named layout", async () => {
    await withTestContext("layout-named", async (context) => {
      await mkdir(join(context.projectDir, "layouts"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "layouts/main.mdx"),
        `---
isLayout: true
---

# Main Layout

<slot />`,
      );

      await writeTextFile(
        join(context.projectDir, "pages/test.mdx"),
        `---
title: Test Page
layout: main
---

# Test Content
`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("test");
        assertExists(result.html);
        assertStringIncludes(result.html, "Test Content");
      });
    });
  });

  it("App Router reserved components", async () => {
    await withTestContext("layout-reserved-components", async (context) => {
      await mkdir(join(context.projectDir, "app/products"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/products/loading.tsx"),
        `export default function Loading() {
  return <div>Loading products...</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/products/error.tsx"),
        `export default function Error({ error }) {
  return <div>Error: {error?.message}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/products/page.mdx"),
        `---
title: Products
---

# Products Page
`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("products");
        assertExists(result.html);
        assertStringIncludes(result.html, "Products Page");
      });
    });
  });

  it("Pages Router with App component", async () => {
    await withTestContext("layout-pages-router-app", async (context) => {
      await writeTextFile(
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

      await writeTextFile(
        join(context.projectDir, "pages/index.mdx"),
        `---
title: Home
---

# Welcome Home
`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("/");
        assertExists(result.html);
        assertStringIncludes(result.html, "Welcome Home");
      });
    });
  });
});
