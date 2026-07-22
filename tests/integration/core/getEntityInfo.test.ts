import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { dirname, join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
} from "../../../src/types/entities/getEntityInfo.ts";
import { createMockAdapter } from "../../../src/platform/adapters/mock.ts";
import { NotSupportedError } from "../../../src/platform/adapters/fs/wrapper.ts";
import { withTestContext } from "../../_helpers/context.ts";

async function createTestFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeTextFile(path, content);
}

function rejectingAsyncIterable(error: unknown): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<never> {
      return { next: () => Promise.reject(error) };
    },
  };
}

describe("getEntityInfo", () => {
  it("handles MDX file with frontmatter", async () => {
    await withTestContext("entity-mdx-frontmatter", async (context) => {
      const testFile = join(context.projectDir, "test.mdx");

      await createTestFile(
        testFile,
        `---
title: Test Page
description: A test page
---

# Hello World

This is a test page.`,
      );

      const info = await getEntityInfo(testFile);

      assertExists(info);
      assertEquals(info.entity.frontmatter.title, "Test Page");
      assertEquals(info.entity.frontmatter.description, "A test page");
      assertEquals(info.entity.content.includes("# Hello World"), true);
      assertEquals(info.entity.type, "page");
      assertEquals(info.entity.isPage, true);
    });
  });

  it("detects layouts correctly", async () => {
    await withTestContext("entity-layout-detection", async (context) => {
      const layoutFile1 = join(context.projectDir, "MainLayout.tsx");
      await createTestFile(layoutFile1, `export default function MainLayout() { /* empty */ }`);

      const info1 = await getEntityInfo(layoutFile1);
      assertExists(info1);
      assertEquals(info1.entity.type, "layout");
      assertEquals(info1.entity.isLayout, true);

      const layoutFile2 = join(context.projectDir, "custom.mdx");
      await createTestFile(
        layoutFile2,
        `---
isLayout: true
---

Layout content`,
      );

      const info2 = await getEntityInfo(layoutFile2);
      assertExists(info2);
      assertEquals(info2.entity.type, "layout");
      assertEquals(info2.entity.isLayout, true);
    });
  });

  it("detects components correctly", async () => {
    await withTestContext("entity-component-detection", async (context) => {
      const componentFile = join(context.projectDir, "Button.tsx");
      await createTestFile(componentFile, `export default function Button() { /* empty */ }`);

      const info = await getEntityInfo(componentFile);
      assertExists(info);
      assertEquals(info.entity.type, "component");
      assertEquals(info.entity.isComponent, true);
    });
  });

  it("returns null for non-existent file", async () => {
    const info = await getEntityInfo("/non/existent/file.mdx");
    assertEquals(info, null);
  });

  it("extracts slug correctly", async () => {
    await withTestContext("entity-slug-extraction", async (context) => {
      const file1 = join(context.projectDir, "about.mdx");
      await createTestFile(file1, "# About");

      const info1 = await getEntityInfo(file1);
      assertExists(info1);
      assertEquals(info1.entity.slug, "about");

      const pagesDir = join(context.projectDir, "pages");
      const file2 = join(pagesDir, "index.mdx");
      await createTestFile(file2, "# Home");

      const info2 = await getEntityInfo(file2);
      assertExists(info2);
      assertEquals(info2.entity.slug, "");

      const blogDir = join(context.projectDir, "blog");
      const file3 = join(blogDir, "index.mdx");
      await createTestFile(file3, "# Blog");

      const info3 = await getEntityInfo(file3);
      assertExists(info3);
      assertEquals(info3.entity.slug, "blog");
    });
  });

  it("handles error gracefully", async () => {
    await withTestContext("entity-error-handling", async (context) => {
      const testFile = join(context.projectDir, "invalid.mdx");
      await createTestFile(
        testFile,
        `---
invalid yaml: [
---

Content`,
      );

      const info = await getEntityInfo(testFile);
      assertExists(info);
      assertEquals(info.entity.content.includes("---"), true);
    });
  });

  it("handles TSX and TS files", async () => {
    await withTestContext("entity-tsx-ts", async (context) => {
      const tsxFile = join(context.projectDir, "Component.tsx");
      await createTestFile(
        tsxFile,
        `export default function Component() { return <div>Hello</div>; }`,
      );

      const tsxInfo = await getEntityInfo(tsxFile);
      assertExists(tsxInfo);
      assertEquals(tsxInfo.entity.type, "component");
      assertEquals(tsxInfo.entity.frontmatter, {});

      const tsFile = join(context.projectDir, "utils.ts");
      await createTestFile(tsFile, `export function util() { return "util"; }`);

      const tsInfo = await getEntityInfo(tsFile);
      assertExists(tsInfo);
      assertEquals(tsInfo.entity.type, "page");
      assertEquals(tsInfo.entity.isPage, true);

      const jsxFile = join(context.projectDir, "AnotherComponent.jsx");
      await createTestFile(
        jsxFile,
        `export default function AnotherComponent() { return <div>JSX</div>; }`,
      );

      const jsxInfo = await getEntityInfo(jsxFile);
      assertExists(jsxInfo);
      assertEquals(jsxInfo.entity.type, "component");
    });
  });

  it("detects lowercase layout filename", async () => {
    await withTestContext("entity-layout-lowercase", async (context) => {
      const layoutFile = join(context.projectDir, "layout.tsx");
      await createTestFile(layoutFile, `export default function Layout() { /* empty */ }`);

      const info = await getEntityInfo(layoutFile);
      assertExists(info);
      assertEquals(info.entity.type, "layout");
      assertEquals(info.entity.isLayout, true);
    });
  });

  it("handles file read error", async () => {
    await withTestContext("entity-read-error", async (context) => {
      const info = await getEntityInfo(context.projectDir);
      assertEquals(info, null);
    });
  });

  it("does not fall through to a host file when adapter stat fails", async () => {
    await withTestContext("entity-adapter-stat-authority", async (context) => {
      const testFile = join(context.projectDir, "remote-only.mdx");
      await createTestFile(testFile, "# Host content must not be returned");

      const adapter = createMockAdapter();
      const backendError = new Error("remote backend unavailable");
      adapter.fs.stat = () => Promise.reject(backendError);

      const error = await assertRejects(() => getEntityInfo(testFile, adapter), Error);

      assertEquals(error, backendError);
    });
  });

  it("does not fall through to a host file when adapter read fails", async () => {
    await withTestContext("entity-adapter-read-authority", async (context) => {
      const testFile = join(context.projectDir, "remote-only.mdx");
      await createTestFile(testFile, "# Host content must not be returned");

      const adapter = createMockAdapter();
      adapter.fs.stat = () =>
        Promise.resolve({
          size: 1,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(),
        });
      const backendError = new Error("remote backend unavailable");
      adapter.fs.readFile = () => Promise.reject(backendError);

      const error = await assertRejects(() => getEntityInfo(testFile, adapter), Error);

      assertEquals(error, backendError);
    });
  });

  it("retains local compatibility for explicitly unsupported adapter operations", async () => {
    await withTestContext("entity-adapter-unsupported-fallback", async (context) => {
      const testFile = join(context.projectDir, "local-compatible.mdx");
      await createTestFile(testFile, "# Local compatibility content");

      const adapter = createMockAdapter();
      adapter.fs.stat = () => Promise.reject(new NotSupportedError("stat", "TestAdapter"));
      adapter.fs.readFile = () => Promise.reject(new NotSupportedError("readFile", "TestAdapter"));

      const info = await getEntityInfo(testFile, adapter);

      assertExists(info);
      assertEquals(info.entity.content, "# Local compatibility content");
    });
  });

  it("returns null for an authoritative adapter not-found result", async () => {
    const adapter = createMockAdapter();

    const info = await getEntityInfo("/project/pages/missing.mdx", adapter);

    assertEquals(info, null);
  });
});

describe("getEntityBySlug", () => {
  it("finds entities by slug", async () => {
    await withTestContext("entity-byslug", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "index.mdx"), "# Home");
      await createTestFile(join(pagesDir, "about.mdx"), "# About");
      await createTestFile(join(pagesDir, "blog", "index.mdx"), "# Blog");

      const homeInfo1 = await getEntityBySlug(context.projectDir, "");
      assertExists(homeInfo1);
      assertEquals(homeInfo1.entity.content.includes("# Home"), true);

      const homeInfo2 = await getEntityBySlug(context.projectDir, "index");
      assertExists(homeInfo2);
      assertEquals(homeInfo2.entity.content.includes("# Home"), true);

      const aboutInfo = await getEntityBySlug(context.projectDir, "about");
      assertExists(aboutInfo);
      assertEquals(aboutInfo.entity.content.includes("# About"), true);

      const blogInfo = await getEntityBySlug(context.projectDir, "blog");
      assertExists(blogInfo);
      assertEquals(blogInfo.entity.content.includes("# Blog"), true);

      const notFound = await getEntityBySlug(context.projectDir, "nonexistent");
      assertEquals(notFound, null);
    });
  });

  it("normalizes leading and trailing slashes in slugs", async () => {
    await withTestContext("entity-byslug-normalized", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "about.mdx"), "# About");

      const info = await getEntityBySlug(context.projectDir, "/about/");

      assertExists(info);
      assertEquals(info.entity.content.includes("# About"), true);
    });
  });

  it("handles additional file extensions", async () => {
    await withTestContext("entity-slug-extensions", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "test.jsx"), "// JSX file");
      await createTestFile(join(pagesDir, "another.ts"), "// TS file");
      await createTestFile(join(pagesDir, "plain.js"), "// JS file");
      await createTestFile(join(pagesDir, "contact", "index.jsx"), "// Contact JSX");

      const jsxInfo = await getEntityBySlug(context.projectDir, "test");
      assertExists(jsxInfo);
      assertEquals(jsxInfo.entity.content, "// JSX file");

      const tsInfo = await getEntityBySlug(context.projectDir, "another");
      assertExists(tsInfo);
      assertEquals(tsInfo.entity.content, "// TS file");

      const jsInfo = await getEntityBySlug(context.projectDir, "plain");
      assertExists(jsInfo);
      assertEquals(jsInfo.entity.content, "// JS file");

      const contactInfo = await getEntityBySlug(context.projectDir, "contact");
      assertExists(contactInfo);
      assertEquals(contactInfo.entity.content, "// Contact JSX");
    });
  });

  it("does not misclassify pages/layouts/ files as layouts", async () => {
    await withTestContext("entity-pages-layouts-dir", async (context) => {
      const layoutsPageDir = join(context.projectDir, "pages", "layouts");
      await createTestFile(
        join(layoutsPageDir, "index.tsx"),
        `export default function LayoutsIndex() { return <div>Layouts page</div>; }`,
      );

      const info = await getEntityInfo(join(layoutsPageDir, "index.tsx"));
      assertExists(info);
      assertEquals(info.entity.isPage, true);
      assertEquals(info.entity.isLayout, false);
    });
  });

  it("skips non-page entities", async () => {
    await withTestContext("entity-slug-skip", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(
        join(pagesDir, "Layout.tsx"),
        `export default function Layout() { /* empty */ }`,
      );
      await createTestFile(
        join(pagesDir, "chat", "layout.tsx"),
        `export default function ChatLayout() { /* empty */ }`,
      );

      await createTestFile(
        join(pagesDir, "page.tsx"),
        `export default function Page() { /* empty */ }`,
      );

      const layoutInfo = await getEntityBySlug(context.projectDir, "Layout");
      assertEquals(layoutInfo, null);

      const nestedLayoutInfo = await getEntityBySlug(context.projectDir, "chat/layout");
      assertEquals(nestedLayoutInfo, null);

      const pageInfo = await getEntityBySlug(context.projectDir, "page");
      assertExists(pageInfo);
      assertEquals(pageInfo.entity.isPage, true);
    });
  });

  it("selects a dynamic segment over catch-all routes regardless of directory order", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    adapter.fs.files.set(
      join(projectDir, "pages", "[...all].tsx"),
      "// lower-priority catch-all",
    );
    adapter.fs.files.set(
      join(projectDir, "pages", "[id].tsx"),
      "// higher-priority dynamic segment",
    );

    const info = await getEntityBySlug(projectDir, "post", adapter);

    assertExists(info);
    assertEquals(info.entity.content, "// higher-priority dynamic segment");
  });

  it("selects a required catch-all over an optional catch-all", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    adapter.fs.files.set(
      join(projectDir, "pages", "[[...all]].tsx"),
      "// lower-priority optional catch-all",
    );
    adapter.fs.files.set(
      join(projectDir, "pages", "[...all].tsx"),
      "// higher-priority required catch-all",
    );

    const info = await getEntityBySlug(projectDir, "docs/getting-started", adapter);

    assertExists(info);
    assertEquals(info.entity.content, "// higher-priority required catch-all");
  });

  it("fails closed when equally specific dynamic routes are ambiguous", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    adapter.fs.files.set(join(projectDir, "pages", "[id].tsx"), "// id route");
    adapter.fs.files.set(join(projectDir, "pages", "[slug].tsx"), "// slug route");

    const info = await getEntityBySlug(projectDir, "post", adapter);

    assertEquals(info, null);
  });

  it("propagates a dynamic-directory stat failure with its original provenance", async () => {
    await withTestContext("entity-dynamic-directory-stat", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "[id].tsx"), "// host-only route");

      const adapter = createMockAdapter();
      const adapterStat = adapter.fs.stat.bind(adapter.fs);
      const backendError = new Error("remote directory stat unavailable");
      adapter.fs.stat = (path) =>
        path === pagesDir ? Promise.reject(backendError) : adapterStat(path);

      const error = await assertRejects(
        () => getEntityBySlug(context.projectDir, "post", adapter),
        Error,
      );

      assertEquals(error, backendError);
    });
  });

  it("propagates a dynamic-directory read failure with its original provenance", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    const pagesDir = join(projectDir, "pages");
    adapter.fs.directories.add(pagesDir);
    const backendError = new Error("remote directory read unavailable");
    adapter.fs.readDir = () => rejectingAsyncIterable(backendError);

    const error = await assertRejects(
      () => getEntityBySlug(projectDir, "post", adapter),
      Error,
    );

    assertEquals(error, backendError);
  });

  it("uses host dynamic routes only for explicitly unsupported adapter operations", async () => {
    await withTestContext("entity-dynamic-unsupported-fallback", async (context) => {
      await createTestFile(
        join(context.projectDir, "pages", "[id].tsx"),
        "// explicit unsupported fallback",
      );

      const adapter = createMockAdapter();
      adapter.fs.stat = () => Promise.reject(new NotSupportedError("stat", "TestAdapter"));
      adapter.fs.readFile = () => Promise.reject(new NotSupportedError("readFile", "TestAdapter"));
      adapter.fs.readDir = () =>
        rejectingAsyncIterable(new NotSupportedError("readDir", "TestAdapter"));

      const info = await getEntityBySlug(context.projectDir, "post", adapter);

      assertExists(info);
      assertEquals(info.entity.content, "// explicit unsupported fallback");
    });
  });
});

describe("getLayoutEntity", () => {
  it("finds layout entities", async () => {
    await withTestContext("entity-layout-find", async (context) => {
      const layoutsDir = join(context.projectDir, "layouts");
      await createTestFile(
        join(layoutsDir, "main.mdx"),
        `---
isLayout: true
---
Main layout`,
      );

      const componentsDir = join(context.projectDir, "components");
      await createTestFile(
        join(componentsDir, "DefaultLayout.tsx"),
        `export default function DefaultLayout() {
    // No implementation
  }`,
      );

      const mainLayout = await getLayoutEntity(context.projectDir, "main");
      assertExists(mainLayout);
      assertEquals(mainLayout.entity.content.includes("Main layout"), true);

      const defaultLayout = await getLayoutEntity(context.projectDir, "Default");
      assertExists(defaultLayout);
      assertEquals(defaultLayout.entity.isLayout, true);

      const notFound = await getLayoutEntity(context.projectDir, "nonexistent");
      assertEquals(notFound, null);
    });
  });

  it("finds Layout.mdx in components", async () => {
    await withTestContext("entity-layout-components", async (context) => {
      const componentsDir = join(context.projectDir, "components");
      await createTestFile(
        join(componentsDir, "Layout.mdx"),
        `---
isLayout: true
---
Generic layout`,
      );

      const genericLayout = await getLayoutEntity(context.projectDir, "any");
      assertExists(genericLayout);
      assertEquals(genericLayout.entity.content.includes("Generic layout"), true);
    });
  });

  it("finds layout in layouts/ with .jsx extension", async () => {
    await withTestContext("entity-layout-jsx", async (context) => {
      const layoutsDir = join(context.projectDir, "layouts");
      await createTestFile(
        join(layoutsDir, "sidebar.jsx"),
        `export default function SidebarLayout({ children }) {
    return children;
  }`,
      );

      const layout = await getLayoutEntity(context.projectDir, "sidebar");
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
    });
  });

  it("finds layout in layouts/ with .ts extension", async () => {
    await withTestContext("entity-layout-ts", async (context) => {
      const layoutsDir = join(context.projectDir, "layouts");
      await createTestFile(
        join(layoutsDir, "minimal.ts"),
        `export default function MinimalLayout({ children }: { children: any }) {
    return children;
  }`,
      );

      const layout = await getLayoutEntity(context.projectDir, "minimal");
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
    });
  });

  it("finds layout in layouts/ with .js extension", async () => {
    await withTestContext("entity-layout-js", async (context) => {
      const layoutsDir = join(context.projectDir, "layouts");
      await createTestFile(
        join(layoutsDir, "simple.js"),
        `export default function SimpleLayout({ children }) {
    return children;
  }`,
      );

      const layout = await getLayoutEntity(context.projectDir, "simple");
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
    });
  });

  it("finds ComponentLayout in components/ with .jsx extension", async () => {
    await withTestContext("entity-layout-component-jsx", async (context) => {
      const componentsDir = join(context.projectDir, "components");
      await createTestFile(
        join(componentsDir, "BlogLayout.jsx"),
        `export default function BlogLayout({ children }) {
    return children;
  }`,
      );

      const layout = await getLayoutEntity(context.projectDir, "Blog");
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
    });
  });

  it("finds Layout fallback in components/ with .jsx extension", async () => {
    await withTestContext("entity-layout-fallback-jsx", async (context) => {
      const componentsDir = join(context.projectDir, "components");
      await createTestFile(
        join(componentsDir, "Layout.jsx"),
        `export default function Layout({ children }) {
    return children;
  }`,
      );

      const layout = await getLayoutEntity(context.projectDir, "anything");
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
    });
  });

  it("finds layout with explicit path in components/layouts/", async () => {
    await withTestContext("entity-layout-nested-path", async (context) => {
      const layoutsDir = join(context.projectDir, "components", "layouts");
      await createTestFile(
        join(layoutsDir, "DefaultLayout.mdx"),
        `---
isLayout: true
---
Default nested layout`,
      );

      const layout = await getLayoutEntity(
        context.projectDir,
        "components/layouts/DefaultLayout.mdx",
      );
      assertExists(layout);
      assertEquals(layout.entity.isLayout, true);
      assertEquals(layout.entity.content.includes("Default nested layout"), true);
    });
  });

  it("resolves an optional catch-all at its own root (/optional and deeper)", async () => {
    await withTestContext("entity-optional-catch-all-root", async (context) => {
      await createTestFile(
        join(context.projectDir, "pages", "optional", "[[...slug]].tsx"),
        `export default function Optional() { return null; }`,
      );

      // Regression: the bare parent path must resolve the optional catch-all
      // matching zero remaining segments, not 404. Before the fix the dynamic
      // resolver never looked inside pages/optional/ for /optional, so only
      // /optional/a/b worked.
      const root = await getEntityBySlug(context.projectDir, "optional");
      assertExists(root);
      assertEquals(root.entity.isPage, true);

      const deep = await getEntityBySlug(context.projectDir, "optional/a/b");
      assertExists(deep);
      assertEquals(deep.entity.isPage, true);
    });
  });
});
