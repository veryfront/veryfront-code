/**
 * Integration tests for the complete layout system
 * Tests nested layouts, providers, and App Router reserved components
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../_helpers/context.ts";

async function createRenderer(
  projectDir: string,
  mode: "development" | "production" = "development",
): Promise<VeryfrontRenderer> {
  const adapter = await getAdapter();
  const renderer = new VeryfrontRenderer({
    projectDir,
    mode,
    adapter,
  });

  await renderer.initialize();
  return renderer;
}

async function withRenderer(
  projectDir: string,
  fn: (renderer: VeryfrontRenderer) => Promise<void>,
  mode: "development" | "production" = "development",
): Promise<void> {
  const renderer = await createRenderer(projectDir, mode);
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
        assertStringIncludes(result.html, 'id="root-layout"');
        assertStringIncludes(result.html, 'id="blog-layout"');
        // Root layout wraps the blog layout
        assertEquals(
          result.html.indexOf('id="root-layout"') < result.html.indexOf('id="blog-layout"'),
          true,
        );
      });
    });
  });

  it("tsx page inherits nested layouts by default", async () => {
    await withTestContext("layout-tsx-default-chain", async (context) => {
      await mkdir(join(context.projectDir, "app/about"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/about/page.tsx"),
        `export default function AboutPage() {
  return <div>About page</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("about");
        assertExists(result.html);
        assertStringIncludes(result.html, "About page");
        assertStringIncludes(result.html, 'id="root-layout"');
      });
    });
  });

  it("uses the resolved Pages route layout in a mixed-router project", async () => {
    await withTestContext("layout-mixed-router-pages-route", async (context) => {
      await mkdir(join(context.projectDir, "app"), { recursive: true });
      await mkdir(join(context.projectDir, "pages/chat"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function AppLayout({ children }) {
  return <div id="app-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "pages/chat/layout.tsx"),
        `export default function ChatLayout({ children }) {
  return <main id="chat-route-layout">{children}</main>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "pages/chat/index.tsx"),
        `export default function ChatPage() {
  return <div>Chat page</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "components/layout.tsx"),
        `export default function FallbackLayout({ children }) {
  return <aside id="dashboard-fallback-layout">{children}</aside>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "components/app.tsx"),
        `export default function App({ children }) {
  return <div id="pages-app-wrapper">{children}</div>;
}`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("chat");
        assertExists(result.html);
        assertStringIncludes(result.html, 'id="chat-route-layout"');
        assertStringIncludes(result.html, 'id="pages-app-wrapper"');
        assertEquals(result.html.includes('id="dashboard-fallback-layout"'), false);
        const payload = result.html.match(
          /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        assertExists(payload);
        const hydrationData = JSON.parse(payload) as {
          layouts?: Array<{ kind?: string; path?: string }>;
          pagePath?: string;
        };
        assertEquals(hydrationData.pagePath, "pages/chat/index.tsx");
        assertEquals(hydrationData.layouts, [{
          kind: "tsx",
          path: "pages/chat/layout.tsx",
        }]);
      }, "production");
    });
  });

  it("preserves convention layouts when the project has a hidden ancestor", async () => {
    await withTestContext("layout-mixed-router-pages-conventions", async (context) => {
      const projectDir = join(context.projectDir, ".worktrees", "project");
      await mkdir(join(projectDir, "app"), { recursive: true });
      await mkdir(join(projectDir, "components"), { recursive: true });
      await mkdir(join(projectDir, "pages/chat"), { recursive: true });

      await writeTextFile(
        join(projectDir, "app/layout.tsx"),
        `export default function AppLayout({ children }) {
  return <div id="app-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(projectDir, "components/layout.tsx"),
        `export default function DashboardLayout({ children }) {
  return <aside id="dashboard-layout">{children}</aside>;
}`,
      );

      await writeTextFile(
        join(projectDir, "components/app.tsx"),
        `export default function App({ children }) {
  return <div id="pages-app-wrapper">{children}</div>;
}`,
      );

      await writeTextFile(
        join(projectDir, "pages/review.tsx"),
        `export default function ReviewPage() {
  return <div>Review page</div>;
}`,
      );

      await writeTextFile(
        join(projectDir, "pages/chat/layout.tsx"),
        `export default function ChatLayout({ children }) {
  return <main id="chat-route-layout">{children}</main>;
}`,
      );

      await writeTextFile(
        join(projectDir, "pages/chat/index.tsx"),
        `export default function ChatPage() {
  return <div>Chat page</div>;
}`,
      );

      await withRenderer(projectDir, async (renderer) => {
        const review = await renderer.renderPage("review");
        assertExists(review.html);
        assertStringIncludes(review.html, 'id="dashboard-layout"');
        assertStringIncludes(review.html, 'id="pages-app-wrapper"');
        assertEquals(review.html.includes('id="app-layout"'), false);

        const chat = await renderer.renderPage("chat");
        assertExists(chat.html);
        assertStringIncludes(chat.html, 'id="chat-route-layout"');
        assertStringIncludes(chat.html, 'id="pages-app-wrapper"');
        assertEquals(chat.html.includes('id="dashboard-layout"'), false);
        assertEquals(chat.html.includes('id="app-layout"'), false);
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

  it("named layout replaces the nested chain without root inheritance", async () => {
    await withTestContext("layout-named-replaces-chain", async (context) => {
      await mkdir(join(context.projectDir, "app/promo"), { recursive: true });
      await mkdir(join(context.projectDir, "layouts"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "layouts/special.tsx"),
        `export default function SpecialLayout({ children }) {
  return <div id="special-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/promo/page.mdx"),
        `---
title: Promo
layout: special
---

# Promo Content
`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("promo");
        assertExists(result.html);
        assertStringIncludes(result.html, "Promo Content");
        assertStringIncludes(result.html, 'id="special-layout"');
        assertEquals(result.html.includes('id="root-layout"'), false);
      });
    });
  });

  it("layout: false frontmatter renders the page bare", async () => {
    await withTestContext("layout-false-mdx", async (context) => {
      await mkdir(join(context.projectDir, "app/standalone"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/standalone/page.mdx"),
        `---
title: Standalone
layout: false
---

# Standalone Content
`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("standalone");
        assertExists(result.html);
        assertStringIncludes(result.html, "Standalone Content");
        assertEquals(result.html.includes('id="root-layout"'), false);
      });
    });
  });

  it("tsx page with export const layout = false renders bare", async () => {
    await withTestContext("layout-tsx-export-false", async (context) => {
      await mkdir(join(context.projectDir, "app/bare"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/bare/page.tsx"),
        `export const layout = false;

export default function BarePage() {
  return <div>Bare page content</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("bare");
        assertExists(result.html);
        assertStringIncludes(result.html, "Bare page content");
        assertEquals(result.html.includes('id="root-layout"'), false);
      });
    });
  });

  it("tsx page with a named layout export replaces the chain", async () => {
    await withTestContext("layout-tsx-export-named", async (context) => {
      await mkdir(join(context.projectDir, "app/branded"), { recursive: true });
      await mkdir(join(context.projectDir, "layouts"), { recursive: true });

      await writeTextFile(
        join(context.projectDir, "app/layout.tsx"),
        `export default function RootLayout({ children }) {
  return <div id="root-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "layouts/special.tsx"),
        `export default function SpecialLayout({ children }) {
  return <div id="special-layout">{children}</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "app/branded/page.tsx"),
        `export const layout = "special";

export default function BrandedPage() {
  return <div>Branded page content</div>;
}`,
      );

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
  router: 'app',
};`,
      );

      await withRenderer(context.projectDir, async (renderer) => {
        const result = await renderer.renderPage("branded");
        assertExists(result.html);
        assertStringIncludes(result.html, "Branded page content");
        assertStringIncludes(result.html, 'id="special-layout"');
        assertEquals(result.html.includes('id="root-layout"'), false);
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
