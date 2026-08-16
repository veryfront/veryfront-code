/**
 * Tests for LayoutCollector
 */

import "../../../_helpers/contract-init.ts";
// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { join } from "#veryfront/compat/path";
import { LayoutCollector } from "../../../../src/rendering/layouts/layout-collector.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { EntityInfo, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

function createMockCompileMDX(): (
  _content: string,
  frontmatter?: Record<string, unknown>,
) => Promise<MdxBundle> {
  return (_content: string, frontmatter?: Record<string, unknown>) =>
    Promise.resolve({
      compiledCode: `export default () => "compiled"`,
      frontmatter: frontmatter ?? {},
    } as MdxBundle);
}

function createPageInfo(
  projectDir: string,
  relativePath: string,
  frontmatter: Record<string, unknown>,
  content = "# Test Page",
): EntityInfo {
  return {
    entity: {
      id: join(projectDir, relativePath),
      path: relativePath,
      slug: relativePath.replace(/^pages\//, "").replace(/\.[^.]+$/, ""),
      type: "page",
      content,
      frontmatter,
    },
  };
}

async function createCollector(
  projectDir: string,
  config: VeryfrontConfig = {},
): Promise<LayoutCollector> {
  const adapter = await getAdapter();
  return new LayoutCollector({
    projectDir,
    adapter,
    config,
    compileMDX: createMockCompileMDX(),
  });
}

describe("LayoutCollector", () => {
  it("collects named layout from frontmatter", async () => {
    const projectDir = await createTestProjectDir();

    try {
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

      const pageInfo: EntityInfo = {
        entity: {
          id: join(projectDir, "pages/test.mdx"),
          path: "pages/test.mdx",
          slug: "test",
          type: "page",
          content: "# Test Page",
          frontmatter: { layout: "main" },
        },
      };

      const adapter = await getAdapter();
      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: {},
        compileMDX: createMockCompileMDX(),
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
      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: {},
        compileMDX: createMockCompileMDX(),
      });

      const result = await collector.collectLayouts(pageInfo);

      // Should find 2 layouts: root and blog
      assertEquals(result.nestedLayouts.length >= 1, true);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  for (
    const testCase of [
      { router: "app" as const, directoryKey: "app" as const, directory: "src/routes" },
      { router: "pages" as const, directoryKey: "pages" as const, directory: "src/legacy" },
    ]
  ) {
    it(`collects nested layouts from the configured ${testCase.router} directory`, async () => {
      const projectDir = await createTestProjectDir();
      const routeRoot = join(projectDir, testCase.directory);
      const nestedRoot = join(routeRoot, "blog");

      try {
        await mkdir(nestedRoot, { recursive: true });
        await writeTextFile(
          join(routeRoot, "layout.tsx"),
          `export default function RootLayout({ children }) { return children; }`,
        );
        await writeTextFile(
          join(nestedRoot, "layout.tsx"),
          `export default function BlogLayout({ children }) { return children; }`,
        );

        const pagePath = join(nestedRoot, testCase.router === "app" ? "page.tsx" : "post.tsx");
        const pageInfo: EntityInfo = {
          entity: {
            id: pagePath,
            path: pagePath,
            slug: "blog/post",
            type: "page",
            content: "export default () => null;",
            frontmatter: {},
          },
        };
        const adapter = await getAdapter();
        const collector = new LayoutCollector({
          projectDir,
          adapter,
          config: {
            router: testCase.router,
            directories: { [testCase.directoryKey]: testCase.directory },
          },
          compileMDX: createMockCompileMDX(),
        });

        const result = await collector.collectLayouts(pageInfo);

        assertEquals(
          result.nestedLayouts.map((layout) => layout.path).sort(),
          [join(routeRoot, "layout.tsx"), join(nestedRoot, "layout.tsx")].sort(),
        );
      } finally {
        await cleanupTestDir(projectDir);
      }
    });
  }

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
      const collector = new LayoutCollector({
        projectDir,
        adapter,
        config: { layout: "main" },
        compileMDX: () => {
          throw new Error("Should not compile layout");
        },
      });

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      // Frontmatter layout: false wins over config.layout - no layouts at all
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("uses default layout from config", async () => {
    const projectDir = await createTestProjectDir();

    try {
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
          frontmatter: frontmatter ?? {},
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
      assertExists(result.nestedLayouts[0]?.bundle);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("collects nested layouts in root-to-leaf order", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "pages/blog"), { recursive: true });
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );
      await writeTextFile(
        join(projectDir, "pages/blog/layout.tsx"),
        `export default function BlogLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/blog/post.mdx", {});
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(
        result.nestedLayouts.map((layout) => layout.path),
        [join(projectDir, "pages/layout.tsx"), join(projectDir, "pages/blog/layout.tsx")],
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("resolves named layout from the layouts directory", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "layouts/main.mdx"),
        `---
isLayout: true
---

# Main Layout

<slot />`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", { layout: "main" });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(result.nestedLayouts[0]?.path, join(projectDir, "layouts/main.mdx"));
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("resolves named layout from components/<Name>Layout", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "components"), { recursive: true });
      await writeTextFile(
        join(projectDir, "components/MainLayout.tsx"),
        `export default function MainLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", { layout: "Main" });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(
        result.nestedLayouts[0]?.path,
        join(projectDir, "components/MainLayout.tsx"),
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("resolves named layout from components/Layout fallback", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "components"), { recursive: true });
      await writeTextFile(
        join(projectDir, "components/Layout.tsx"),
        `export default function Layout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", { layout: "Sidebar" });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(result.nestedLayouts[0]?.path, join(projectDir, "components/Layout.tsx"));
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("resolves named layout from an explicit @/ path", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "layouts/custom.tsx"),
        `export default function CustomLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", {
        layout: "@/layouts/custom.tsx",
      });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(result.nestedLayouts[0]?.path, join(projectDir, "layouts/custom.tsx"));
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("resolves named layout from an explicit @components/ path", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "components"), { recursive: true });
      await writeTextFile(
        join(projectDir, "components/CustomLayout.tsx"),
        `export default function CustomLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", {
        layout: "@components/CustomLayout.tsx",
      });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.nestedLayouts.length, 1);
      assertEquals(
        result.nestedLayouts[0]?.path,
        join(projectDir, "components/CustomLayout.tsx"),
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("throws LAYOUT_NOT_FOUND for an unknown named layout", async () => {
    const projectDir = await createTestProjectDir();

    try {
      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", {
        layout: "does-not-exist",
      });
      const collector = await createCollector(projectDir);

      await assertRejects(
        async () => await collector.collectLayouts(pageInfo),
        Error,
        'Layout "does-not-exist" not found',
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("returns no layouts for layout: false without a config layout", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", { layout: false });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("treats string 'false' as layout disabled", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", { layout: "false" });
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("config.layout: false disables the default layout", async () => {
    const projectDir = await createTestProjectDir();

    try {
      const pageInfo = createPageInfo(projectDir, "pages/test.mdx", {});
      const collector = await createCollector(projectDir, { layout: false });

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("honors export const layout = false on tsx pages", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/bare.tsx",
        {},
        `export const layout = false;

export default function BarePage() {
  return <div>Bare page</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("honors export const layout = 'Name' on tsx pages", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );
      await writeTextFile(
        join(projectDir, "layouts/special.tsx"),
        `export default function SpecialLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/branded.tsx",
        {},
        `export const layout = "special";

export default function BrandedPage() {
  return <div>Branded page</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      // Named layout replaces the nested chain - root layout is not inherited
      assertEquals(
        result.nestedLayouts.map((layout) => layout.path),
        [join(projectDir, "layouts/special.tsx")],
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("ignores a local const layout inside a tsx component body", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/grid.tsx",
        {},
        `export default function GridPage() {
  const layout = "grid";
  return <div className={layout}>Grid page</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      // A non-exported local variable is not a layout signal - the nested
      // chain stays intact and no LAYOUT_NOT_FOUND is thrown.
      assertEquals(
        result.nestedLayouts.map((layout) => layout.path),
        [join(projectDir, "pages/layout.tsx")],
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("ignores non-exported layout mentions (local false, comments) on tsx pages", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/wide.tsx",
        {},
        `// const layout = "wide"
export default function WidePage() {
  const layout = false;
  return <div>{layout ? "on" : "off"}</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      // Neither the comment nor the local const disables or renames the layout.
      assertEquals(
        result.nestedLayouts.map((layout) => layout.path),
        [join(projectDir, "pages/layout.tsx")],
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("honors export const frontmatter layout on tsx pages", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/bare.tsx",
        {},
        `export const frontmatter = { layout: false };

export default function BarePage() {
  return <div>Bare page</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("ignores layout exports inside block comments and template literals", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/example.tsx",
        {},
        `/*
export const frontmatter = { layout: false };
*/
const example = \`
export const layout = false;
\`;

export default function ExamplePage() {
  return <pre>{example}</pre>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(
        result.nestedLayouts.map((layout) => layout.path),
        [join(projectDir, "pages/layout.tsx")],
      );
    } finally {
      await cleanupTestDir(projectDir);
    }
  });

  it("honors formatted frontmatter exports with trailing commas", async () => {
    const projectDir = await createTestProjectDir();

    try {
      await writeTextFile(
        join(projectDir, "pages/layout.tsx"),
        `export default function RootLayout({ children }) { return children; }`,
      );

      const pageInfo = createPageInfo(
        projectDir,
        "pages/bare.tsx",
        {},
        `export const frontmatter = {
  layout: false,
};

export default function BarePage() {
  return <div>Bare page</div>;
}`,
      );
      const collector = await createCollector(projectDir);

      const result = await collector.collectLayouts(pageInfo);

      assertEquals(result.layoutBundle, undefined);
      assertEquals(result.nestedLayouts, []);
    } finally {
      await cleanupTestDir(projectDir);
    }
  });
});
