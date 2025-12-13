
import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { LayoutCollector } from "../../../../src/rendering/layouts/layout-collector.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";
import type { EntityInfo } from "@veryfront/types";
import type { MdxBundle } from "@veryfront/types";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

Deno.test("LayoutCollector - collects named layout from frontmatter", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "layouts/main.mdx"),
      `---
title: Main Layout
isLayout: true
---

# Main Layout

<slot />
`,
    );

    const pageInfo: EntityInfo = {
      entity: {
        id: join(projectDir, "pages/test.mdx"),
        slug: "test",
        type: "page",
        content: "# Test Page",
        frontmatter: {
          layout: "main",
        },
      },
    };

    const adapter = new DenoAdapter();
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

    assertExists(result.layoutBundle);
    assertEquals(result.layoutBundle.frontmatter?.isLayout, true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("LayoutCollector - collects nested directory layouts", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages/blog"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/layout.tsx"),
      `export default function RootLayout({ children }) { return children; }`,
    );
    await Deno.writeTextFile(
      join(projectDir, "pages/blog/layout.tsx"),
      `export default function BlogLayout({ children }) { return children; }`,
    );

    const pageInfo: EntityInfo = {
      entity: {
        id: join(projectDir, "pages/blog/post.mdx"),
        slug: "blog/post",
        type: "page",
        content: "# Blog Post",
        frontmatter: {},
      },
    };

    const adapter = new DenoAdapter();
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

    assertEquals(result.nestedLayouts.length >= 1, true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("LayoutCollector - respects layout: false in frontmatter", async () => {
  const projectDir = await createTestProjectDir();

  try {
    const pageInfo: EntityInfo = {
      entity: {
        id: join(projectDir, "pages/test.mdx"),
        slug: "test",
        type: "page",
        content: "# Test Page",
        frontmatter: {
          layout: false as any, // Type casting for test - layout can be false in runtime
        },
      },
    };

    const adapter = new DenoAdapter();
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

Deno.test("LayoutCollector - uses default layout from config", async () => {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(
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
        slug: "test",
        type: "page",
        content: "# Test Page",
        frontmatter: {},
      },
    };

    const adapter = new DenoAdapter();
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
      config: { defaultLayout: "default" },
      compileMDX: mockCompileMDX,
    });

    const result = await collector.collectLayouts(pageInfo);

    assertEquals(compileCalled, true);
    assertExists(result.layoutBundle);
  } finally {
    await cleanupTestDir(projectDir);
  }
});
