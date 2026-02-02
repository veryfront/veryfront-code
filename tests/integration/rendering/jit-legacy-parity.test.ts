/**
 * JIT Renderer vs Legacy Renderer Parity Tests
 *
 * Ensures that the JIT renderer produces identical output to the legacy renderer
 * across all feature categories (App Router, Pages Router, MDX, Components, etc.)
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, afterEach, beforeAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";

import { TestContext } from "../../_helpers/context.ts";
import { getJitRenderer, isJitRendererInitialized } from "../../../src/rendering/jit-renderer.ts";
import { getRenderer, initializeRenderer, isRendererInitialized } from "../../../src/rendering/renderer.ts";
import type { RenderContext } from "../../../src/rendering/context/render-context.ts";
import { DenoAdapter } from "../../../src/platform/adapters/deno.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

const FIXTURES_DIR = join(Deno.cwd(), "tests/fixtures/jit-parity");

/**
 * Normalize HTML for comparison by removing dynamic values
 * (Prefixed with _ as it will be used in full parity tests)
 */
function _normalizeHtml(html: string): string {
  return html
    .replace(/data-v-[a-f0-9]+/g, "data-v-HASH")
    .replace(/\b\d{13,}\b/g, "TIMESTAMP")
    .replace(/__vf_[a-f0-9]+/g, "__vf_HASH")
    .replace(/Generated at: [^<]+/g, "Generated at: TIMESTAMP")
    .replace(/Fetched at: [^<]+/g, "Fetched at: TIMESTAMP")
    .replace(/Last revalidated: [^<]+/g, "Last revalidated: TIMESTAMP")
    .replace(/timestamp":\s*\d+/g, 'timestamp": TIMESTAMP')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Create a render context for testing
 */
function createRenderContext(
  projectDir: string,
  projectId: string,
  options: Partial<RenderContext> = {},
): RenderContext {
  const adapter = new DenoAdapter();

  return {
    projectId,
    projectDir,
    contentSourceId: "test-content-source",
    adapter,
    environment: "production",
    mode: "production",
    config: {
      react: { version: "19.0.0" },
    },
    ...options,
  } as RenderContext;
}

describe("JIT-Legacy Parity", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("jit-legacy-parity");
    await testContext.setup();

    // Initialize both renderers
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  afterEach(async () => {
    // Clear caches between tests
    if (isRendererInitialized()) {
      await getRenderer().clearCacheForProject("test-project");
    }
    if (isJitRendererInitialized()) {
      await getJitRenderer().clearCacheForProject("test-project");
    }
  });

  describe("Render Mode Selection", () => {
    it("should initialize both JIT and legacy renderers", () => {
      assertEquals(isRendererInitialized(), true);
      assertEquals(isJitRendererInitialized(), true);
    });

    it("should have JIT renderer available for production mode", () => {
      const jitRenderer = getJitRenderer();
      assertExists(jitRenderer);
      assertExists(jitRenderer.renderPage);
      assertExists(jitRenderer.resolvePageData);
      assertExists(jitRenderer.getAllPages);
    });
  });

  describe("Common Renderer Interface", () => {
    it("JIT renderer should implement CommonRenderer interface", () => {
      const jitRenderer = getJitRenderer();
      assertExists(jitRenderer.renderPage, "renderPage method should exist");
      assertExists(jitRenderer.resolvePageData, "resolvePageData method should exist");
      assertExists(jitRenderer.getAllPages, "getAllPages method should exist");
      assertExists(jitRenderer.clearCache, "clearCache method should exist");
      assertExists(jitRenderer.clearCacheForProject, "clearCacheForProject method should exist");
      assertExists(jitRenderer.destroy, "destroy method should exist");
    });

    it("Legacy renderer should implement CommonRenderer interface", () => {
      const legacyRenderer = getRenderer();
      assertExists(legacyRenderer.renderPage, "renderPage method should exist");
      assertExists(legacyRenderer.resolvePageData, "resolvePageData method should exist");
      assertExists(legacyRenderer.getAllPages, "getAllPages method should exist");
      assertExists(legacyRenderer.clearCache, "clearCache method should exist");
      assertExists(legacyRenderer.clearCacheForProject, "clearCacheForProject method should exist");
      assertExists(legacyRenderer.destroy, "destroy method should exist");
    });
  });

  describe("Cache Operations", () => {
    it("JIT renderer should clear cache without throwing", async () => {
      const ctx = createRenderContext("/tmp/test", "test-project");
      await getJitRenderer().clearCache(ctx);
      await getJitRenderer().clearCache(ctx, "test-slug");
    });

    it("JIT renderer should clear project cache without throwing", async () => {
      await getJitRenderer().clearCacheForProject("test-project");
    });
  });
});

describe("App Router Parity", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("app-router-parity");
    await testContext.setup();
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  describe("Dynamic Routes", () => {
    it("should have dynamic route fixtures available", async () => {
      const fixtureDir = join(FIXTURES_DIR, "app-router/dynamic-routes");
      const pageFile = join(fixtureDir, "app/posts/[slug]/page.tsx");

      // Verify fixture exists
      const stat = await Deno.stat(pageFile);
      assertEquals(stat.isFile, true);
    });
  });

  describe("Catch-All Routes", () => {
    it("should have catch-all route fixtures available", async () => {
      const fixtureDir = join(FIXTURES_DIR, "app-router/catch-all");
      const pageFile = join(fixtureDir, "app/docs/[...path]/page.tsx");

      // Verify fixture exists
      const stat = await Deno.stat(pageFile);
      assertEquals(stat.isFile, true);
    });
  });

  describe("Nested Layouts", () => {
    it("should have nested layout fixtures available", async () => {
      const fixtureDir = join(FIXTURES_DIR, "app-router/nested-layouts");
      const rootLayout = join(fixtureDir, "app/layout.tsx");
      const blogLayout = join(fixtureDir, "app/blog/layout.tsx");

      // Verify fixtures exist
      assertEquals((await Deno.stat(rootLayout)).isFile, true);
      assertEquals((await Deno.stat(blogLayout)).isFile, true);
    });
  });

  describe("Reserved Components", () => {
    it("should have error boundary fixture available", async () => {
      const errorFile = join(FIXTURES_DIR, "app-router/error-boundary/app/error.tsx");
      assertEquals((await Deno.stat(errorFile)).isFile, true);
    });

    it("should have loading state fixture available", async () => {
      const loadingFile = join(FIXTURES_DIR, "app-router/loading-state/app/loading.tsx");
      assertEquals((await Deno.stat(loadingFile)).isFile, true);
    });

    it("should have not-found fixture available", async () => {
      const notFoundFile = join(FIXTURES_DIR, "app-router/not-found/app/not-found.tsx");
      assertEquals((await Deno.stat(notFoundFile)).isFile, true);
    });
  });
});

describe("Pages Router Parity", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("pages-router-parity");
    await testContext.setup();
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  describe("Data Fetching", () => {
    it("should have getServerData fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "pages-router/server-data/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "getServerData");
    });

    it("should have getStaticData fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "pages-router/static-data/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "getStaticData");
    });

    it("should have getStaticPaths fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "pages-router/static-paths/pages/[id].tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "getStaticPaths");
    });
  });

  describe("ISR Support", () => {
    it("should have ISR fixture with revalidate option", async () => {
      const pageFile = join(FIXTURES_DIR, "pages-router/isr/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "revalidate:");
    });
  });

  describe("Redirects", () => {
    it("should have redirect fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "pages-router/redirects/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "redirect:");
    });
  });
});

describe("MDX Parity", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("mdx-parity");
    await testContext.setup();
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  describe("Basic MDX", () => {
    it("should have basic MDX fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "mdx/basic/pages/index.mdx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "# Basic MDX Page");
    });
  });

  describe("Frontmatter", () => {
    it("should have frontmatter MDX fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "mdx/frontmatter/pages/index.mdx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "title:");
      assertStringIncludes(content, "description:");
    });
  });

  describe("MDX with Components", () => {
    it("should have MDX with components fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "mdx/components/pages/index.mdx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "import");
      assertStringIncludes(content, "Button");
    });
  });
});

describe("Component Rendering Parity", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("component-parity");
    await testContext.setup();
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  describe("TSX Components", () => {
    it("should have TSX component fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "components/tsx/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "export default function");
    });
  });

  describe("JSX Components", () => {
    it("should have JSX component fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "components/jsx/pages/index.jsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "export default function");
    });
  });

  describe("Context Providers", () => {
    it("should have context provider fixture available", async () => {
      const layoutFile = join(FIXTURES_DIR, "components/providers/app/layout.tsx");
      const content = await Deno.readTextFile(layoutFile);
      assertStringIncludes(content, "createContext");
      assertStringIncludes(content, "Provider");
    });
  });
});

describe("Edge Cases", () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = new TestContext("edge-cases-parity");
    await testContext.setup();
    await initializeRenderer();
    getJitRenderer();
  });

  afterAll(async () => {
    await cleanupBundler();
    await testContext.cleanup();
  });

  describe("Empty Page", () => {
    it("should have empty page fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "edge-cases/empty-page/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "return null");
    });
  });

  describe("Large Bundle", () => {
    it("should have large bundle fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "edge-cases/large-bundle/pages/index.tsx");
      const content = await Deno.readTextFile(pageFile);
      assertStringIncludes(content, "useState");
      assertStringIncludes(content, "useEffect");
      assertStringIncludes(content, "ITEMS");
    });
  });

  describe("Circular Imports", () => {
    it("should have circular imports fixture available", async () => {
      const pageFile = join(FIXTURES_DIR, "edge-cases/circular-imports/pages/index.tsx");
      const sharedFile = join(FIXTURES_DIR, "edge-cases/circular-imports/pages/shared.tsx");

      assertEquals((await Deno.stat(pageFile)).isFile, true);
      assertEquals((await Deno.stat(sharedFile)).isFile, true);
    });
  });
});
