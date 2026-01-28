import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { dirname, join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
} from "../../../src/types/entities/getEntityInfo.ts";
import { withTestContext } from "../../_helpers/context.ts";

async function createTestFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeTextFile(path, content);
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
      // Test filename-based detection
      const layoutFile1 = join(context.projectDir, "MainLayout.tsx");
      await createTestFile(layoutFile1, `export default function MainLayout() { /* empty */ }`);

      const info1 = await getEntityInfo(layoutFile1);
      assertExists(info1);
      assertEquals(info1.entity.type, "layout");
      assertEquals(info1.entity.isLayout, true);

      // Test frontmatter-based detection
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
      // Regular file
      const file1 = join(context.projectDir, "about.mdx");
      await createTestFile(file1, "# About");
      const info1 = await getEntityInfo(file1);
      assertExists(info1);
      assertEquals(info1.entity.slug, "about");

      // Index file in pages
      const pagesDir = join(context.projectDir, "pages");
      const file2 = join(pagesDir, "index.mdx");
      await createTestFile(file2, "# Home");
      const info2 = await getEntityInfo(file2);
      assertExists(info2);
      assertEquals(info2.entity.slug, "");

      // Index file in subdirectory
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
      // Create a file with invalid content that might cause parsing errors
      const testFile = join(context.projectDir, "invalid.mdx");
      await createTestFile(
        testFile,
        `---
invalid yaml: [
---

Content`,
      );

      // Should handle error gracefully and still return entity info
      const info = await getEntityInfo(testFile);
      assertExists(info);
      // Content should be the full file since frontmatter parsing failed
      assertEquals(info.entity.content.includes("---"), true);
    });
  });

  it("handles TSX and TS files", async () => {
    await withTestContext("entity-tsx-ts", async (context) => {
      // Test TSX file
      const tsxFile = join(context.projectDir, "Component.tsx");
      await createTestFile(
        tsxFile,
        `export default function Component() { return <div>Hello</div>; }`,
      );

      const tsxInfo = await getEntityInfo(tsxFile);
      assertExists(tsxInfo);
      assertEquals(tsxInfo.entity.type, "component");
      assertEquals(tsxInfo.entity.frontmatter, {});

      // Test TS file
      const tsFile = join(context.projectDir, "utils.ts");
      await createTestFile(tsFile, `export function util() { return "util"; }`);

      const tsInfo = await getEntityInfo(tsFile);
      assertExists(tsInfo);
      assertEquals(tsInfo.entity.type, "page");
      assertEquals(tsInfo.entity.isPage, true);

      // Test JSX file
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
      // Try to read a directory as a file
      const info = await getEntityInfo(context.projectDir);
      assertEquals(info, null);
    });
  });
});

describe("getEntityBySlug", () => {
  it("finds entities by slug", async () => {
    await withTestContext("entity-byslug", async (context) => {
      // Create test pages
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "index.mdx"), "# Home");
      await createTestFile(join(pagesDir, "about.mdx"), "# About");
      await createTestFile(join(pagesDir, "blog", "index.mdx"), "# Blog");

      // Test index/home slug
      const homeInfo1 = await getEntityBySlug(context.projectDir, "");
      assertExists(homeInfo1);
      assertEquals(homeInfo1.entity.content.includes("# Home"), true);

      const homeInfo2 = await getEntityBySlug(context.projectDir, "index");
      assertExists(homeInfo2);
      assertEquals(homeInfo2.entity.content.includes("# Home"), true);

      // Test regular slug
      const aboutInfo = await getEntityBySlug(context.projectDir, "about");
      assertExists(aboutInfo);
      assertEquals(aboutInfo.entity.content.includes("# About"), true);

      // Test nested slug
      const blogInfo = await getEntityBySlug(context.projectDir, "blog");
      assertExists(blogInfo);
      assertEquals(blogInfo.entity.content.includes("# Blog"), true);

      // Test non-existent slug
      const notFound = await getEntityBySlug(context.projectDir, "nonexistent");
      assertEquals(notFound, null);
    });
  });

  it("handles additional file extensions", async () => {
    await withTestContext("entity-slug-extensions", async (context) => {
      // Create test files in pages directory with different extensions
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "test.jsx"), "// JSX file");
      await createTestFile(join(pagesDir, "another.ts"), "// TS file");
      await createTestFile(join(pagesDir, "contact", "index.jsx"), "// Contact JSX");

      // Test finding JSX file
      const jsxInfo = await getEntityBySlug(context.projectDir, "test");
      assertExists(jsxInfo);
      assertEquals(jsxInfo.entity.content, "// JSX file");

      // Test finding TS file
      const tsInfo = await getEntityBySlug(context.projectDir, "another");
      assertExists(tsInfo);
      assertEquals(tsInfo.entity.content, "// TS file");

      // Test finding index.jsx in subdirectory
      const contactInfo = await getEntityBySlug(context.projectDir, "contact");
      assertExists(contactInfo);
      assertEquals(contactInfo.entity.content, "// Contact JSX");
    });
  });

  it("skips non-page entities", async () => {
    await withTestContext("entity-slug-skip", async (context) => {
      // Create a layout file that shouldn't be returned by getEntityBySlug
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(
        join(pagesDir, "Layout.tsx"),
        `export default function Layout() { /* empty */ }`,
      );

      // Create a regular page file
      await createTestFile(
        join(pagesDir, "page.tsx"),
        `export default function Page() { /* empty */ }`,
      );

      // getEntityBySlug should skip the layout and return null
      const layoutInfo = await getEntityBySlug(context.projectDir, "Layout");
      assertEquals(layoutInfo, null);

      // But should find the regular page
      const pageInfo = await getEntityBySlug(context.projectDir, "page");
      assertExists(pageInfo);
      assertEquals(pageInfo.entity.isPage, true);
    });
  });
});

describe("getLayoutEntity", () => {
  it("finds layout entities", async () => {
    await withTestContext("entity-layout-find", async (context) => {
      // Create layout files
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

      // Test finding layout by name
      const mainLayout = await getLayoutEntity(context.projectDir, "main");
      assertExists(mainLayout);
      assertEquals(mainLayout.entity.content.includes("Main layout"), true);

      const defaultLayout = await getLayoutEntity(context.projectDir, "Default");
      assertExists(defaultLayout);
      assertEquals(defaultLayout.entity.isLayout, true);

      // Test non-existent layout
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
});
