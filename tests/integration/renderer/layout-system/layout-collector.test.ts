/**
 * Tests for LayoutCollector
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import { join } from "@veryfront/compat/path";
import { LayoutCollector } from "../../../../src/rendering/layouts/layout-collector.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import type { EntityInfo } from "@veryfront/types";
import type { MdxBundle } from "@veryfront/types";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

describe("LayoutCollector", () => {
  it("collects named layout from frontmatter", async () => {
    const projectDir = await createTestProjectDir();

    try {
      // Create layouts directory and layout file
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "layouts/main.mdx"),
        `---
title: Main Layout
isLayout: true
---

# Main Layout

<slot />
`,
      );

      // Create page with layout frontmatter
      const pageInfo: EntityInfo = {
        entity: {
          id: join(projectDir, "pages/test.mdx"),
          path: "pages/test.mdx",
          slug: "test",
          type: "page",
          content: "# Test Page",
          frontmatter: {
            layout: "main",
          },
        },
      };

      const adapter = await getAdapter();
      const mockCompileMDX = (_content: string, frontmatter?: Record<string, unknown>) => {
        return Promise.resolve({
          compiledCode: `export default () => "compiled"`,
          frontmatter: frontmatter || {},
        } as MdxBundle);
      };

      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: {},
        compileMDX: mockCompileMDX,
      });

      const result = await collector.collectLayouts(pageInfo);

      // When using explicit frontmatter layout, the layout is returned in nestedLayouts
      // (not layoutBundle) to prevent double-wrapping during SSR and client hydration
      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(result.nestedLayouts[0]?.kind, "mdx");
      assertExists(result.nestedLayouts[0]?.bundle);
      assertEquals(result.nestedLayouts[0]?.bundle?.frontmatter?.isLayout, true);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("collects nested directory layouts", async () => {
    const projectDir = await createTestProjectDir();

    try {
      // Create nested layout structure
      await mkdir(join(projectDir, "pages/blog"), { recursive: true });
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );
      await writeTextFile(
        join(projectDir, "pages/blog/layout.tsx"),
        `export default function BlogLayout({ children }) { return children; }`,
      );

      const pageInfo: EntityInfo = {
        entity: {
          id: join(projectDir, "pages/blog/post.mdx"),
          path: "pages/blog/post.mdx",
          slug: "blog/post",
          type: "page",
          content: "# Blog Post",
          frontmatter: {},
        },
      };

      const adapter = await getAdapter();
      const mockCompileMDX = (_content: string, frontmatter?: Record<string, unknown>) => {
        return Promise.resolve({
          compiledCode: `export default () => "compiled"`,
          frontmatter: frontmatter || {},
        } as MdxBundle);
      };

      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: {},
        compileMDX: mockCompileMDX,
      });

      const result = await collector.collectLayouts(pageInfo);

      // Should find 2 layouts: root and blog
      assertEquals(result.nestedLayouts.length >= 1, true);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("respects layout: false in frontmatter", async () => {
    const projectDir = await createTestProjectDir();

    try {
      const pageInfo: EntityInfo = {
        entity: {
          id: join(projectDir, "pages/test.mdx"),
          path: "pages/test.mdx",
          slug: "test",
          type: "page",
          content: "# Test Page",
          frontmatter: {
            layout: false as any, // Type casting for test - layout can be false in runtime
          },
        },
      };

      const adapter = await getAdapter();
      const mockCompileMDX = () => {
        throw new Error("Should not compile layout");
      };

      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: { defaultLayout: "main" },
        compileMDX: mockCompileMDX,
      });

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("uses default layout from config", async () => {
    const projectDir = await createTestProjectDir();

    try {
      // Create default layout with isLayout frontmatter
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "layouts/default.mdx"),
        `---
isLayout: true
---

# Default Layout

<slot />`,
      );

      const pageInfo: EntityInfo = {
        entity: {
          id: join(projectDir, "pages/test.mdx"),
          path: "pages/test.mdx",
          slug: "test",
          type: "page",
          content: "# Test Page",
          frontmatter: {},
        },
      };

      const adapter = await getAdapter();
      let compileCalled = false;
      const mockCompileMDX = (_content: string, frontmatter?: Record<string, unknown>) => {
        compileCalled = true;
        return Promise.resolve({
          compiledCode: `export default () => "compiled"`,
          frontmatter: frontmatter || {},
        } as MdxBundle);
      };

      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: { layout: "default" },
        compileMDX: mockCompileMDX,
      });

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(compileCalled, true);
      // defaultLayout is now added to nestedLayouts for SSR/client hydration consistency
      // layoutBundle is undefined, but the layout is in nestedLayouts
      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts.length, 1);
      const nestedLayout = result.nestedLayouts[0];
      assertExists(nestedLayout);
      assertExists(nestedLayout.bundle);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });
});
