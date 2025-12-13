
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import {
  assertEquals as _assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";

afterAll(async () => {
  await cleanupBundler();
});

Deno.test("Layout System Integration - nested layouts with App Router", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "app/blog"), { recursive: true });

    await Deno.writeTextFile(
      join(projectDir, "app/layout.tsx"),
      `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
    );

    await Deno.writeTextFile(
      join(projectDir, "app/blog/layout.tsx"),
      `export default function BlogLayout({ children }) {
  return <div id="blog-layout">{children}</div>;
}`,
    );

    await Deno.writeTextFile(
      join(projectDir, "app/blog/page.mdx"),
      `---
title: Blog Post
---

# My Blog Post

This is a test post.
`,
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  router: 'app',
};`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    const result = await renderer.renderPage("blog");

    assertExists(result.html);
    assertStringIncludes(result.html, "My Blog Post");

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Layout System Integration - named layout with providers", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "layouts/main.mdx"),
      `# Main Layout

<slot />`,
    );

    await Deno.mkdir(join(projectDir, "providers"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "providers/theme.mdx"),
      `export default function ThemeProvider({ children }) {
  return <div className="theme-provider">{children}</div>;
}`,
    );

    await Deno.writeTextFile(
      join(projectDir, "pages/test.mdx"),
      `---
title: Test Page
layout: main
---

# Test Content
`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    const result = await renderer.renderPage("test");

    assertExists(result.html);
    assertStringIncludes(result.html, "Test Content");

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Layout System Integration - App Router reserved components", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "app/products"), { recursive: true });

    await Deno.writeTextFile(
      join(projectDir, "app/products/loading.tsx"),
      `export default function Loading() {
  return <div>Loading products...</div>;
}`,
    );

    await Deno.writeTextFile(
      join(projectDir, "app/products/error.tsx"),
      `export default function Error({ error }) {
  return <div>Error: {error?.message}</div>;
}`,
    );

    await Deno.writeTextFile(
      join(projectDir, "app/products/page.mdx"),
      `---
title: Products
---

# Products Page
`,
    );

    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
  router: 'app',
};`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    const result = await renderer.renderPage("products");

    assertExists(result.html);
    assertStringIncludes(result.html, "Products Page");

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Layout System Integration - Pages Router with App component", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.writeTextFile(
      join(projectDir, "components/app.tsx"),
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

    await Deno.writeTextFile(
      join(projectDir, "pages/index.mdx"),
      `---
title: Home
---

# Welcome Home
`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    const result = await renderer.renderPage("/");

    assertExists(result.html);
    assertStringIncludes(result.html, "Welcome Home");

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});
