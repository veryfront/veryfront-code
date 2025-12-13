import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
  getProviderEntities,
} from "../../../src/core/types/entities/getEntityInfo.ts";
import { withTestContext } from "../../_helpers/context.ts";

async function createTestFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
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

  it("detects providers correctly", async () => {
    await withTestContext("entity-provider-detection", async (context) => {
      const providerFile1 = join(context.projectDir, "ThemeProvider.tsx");
      await createTestFile(
        providerFile1,
        `export default function ThemeProvider() { /* empty */ }`,
      );

      const info1 = await getEntityInfo(providerFile1);
      assertExists(info1);
      assertEquals(info1.entity.type, "provider");
      assertEquals(info1.entity.isProvider, true);

      const providerFile2 = join(context.projectDir, "auth.mdx");
      await createTestFile(
        providerFile2,
        `---
isProvider: true
priority: 1
---

Provider content`,
      );

      const info2 = await getEntityInfo(providerFile2);
      assertExists(info2);
      assertEquals(info2.entity.type, "provider");
      assertEquals(info2.entity.isProvider, true);
      assertEquals(info2.entity.frontmatter.priority, 1);
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

  it("detects lowercase provider filename", async () => {
    await withTestContext("entity-provider-lowercase", async (context) => {
      const providerFile = join(context.projectDir, "provider.tsx");
      await createTestFile(providerFile, `export default function Provider() { /* empty */ }`);

      const info = await getEntityInfo(providerFile);
      assertExists(info);
      assertEquals(info.entity.type, "provider");
      assertEquals(info.entity.isProvider, true);
    });
  });

  it("handles file read error", async () => {
    await withTestContext("entity-read-error", async (context) => {
      const info = await getEntityInfo(context.projectDir);
      assertEquals(info, null);
    });
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

  it("handles additional file extensions", async () => {
    await withTestContext("entity-slug-extensions", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "test.jsx"), "// JSX file");
      await createTestFile(join(pagesDir, "another.ts"), "// TS file");
      await createTestFile(join(pagesDir, "contact", "index.jsx"), "// Contact JSX");

      const jsxInfo = await getEntityBySlug(context.projectDir, "test");
      assertExists(jsxInfo);
      assertEquals(jsxInfo.entity.content, "// JSX file");

      const tsInfo = await getEntityBySlug(context.projectDir, "another");
      assertExists(tsInfo);
      assertEquals(tsInfo.entity.content, "// TS file");

      const contactInfo = await getEntityBySlug(context.projectDir, "contact");
      assertExists(contactInfo);
      assertEquals(contactInfo.entity.content, "// Contact JSX");
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
        join(pagesDir, "page.tsx"),
        `export default function Page() { /* empty */ }`,
      );

      const layoutInfo = await getEntityBySlug(context.projectDir, "Layout");
      assertEquals(layoutInfo, null);

      const pageInfo = await getEntityBySlug(context.projectDir, "page");
      assertExists(pageInfo);
      assertEquals(pageInfo.entity.isPage, true);
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
});

describe("getProviderEntities", () => {
  it("finds and sorts provider entities", async () => {
    await withTestContext("entity-providers", async (context) => {
      const providersDir = join(context.projectDir, "providers");
      await createTestFile(
        join(providersDir, "auth.mdx"),
        `---
isProvider: true
priority: 2
---
Auth provider`,
      );

      await createTestFile(
        join(providersDir, "theme.tsx"),
        `---
isProvider: true
priority: 1
---
export default function ThemeProvider() {
    // No implementation
  }`,
      );

      const componentsDir = join(context.projectDir, "components");
      await createTestFile(
        join(componentsDir, "GlobalProvider.tsx"),
        `export default function GlobalProvider() {
    // No implementation
  }`,
      );

      const providers = await getProviderEntities(context.projectDir);

      assertEquals(providers.length >= 2, true);

      const prioritizedProviders = providers.filter(
        (p) => p.entity.frontmatter.priority !== undefined,
      );
      if (prioritizedProviders.length >= 2) {
        const priority0 = prioritizedProviders[0]?.entity.frontmatter.priority ?? 0;
        const priority1 = prioritizedProviders[1]?.entity.frontmatter.priority ?? 0;
        assertEquals(priority0 <= priority1, true);
      }
    });
  });

  it("handles empty directories", async () => {
    await withTestContext("entity-providers-empty", async (context) => {
      const providers = await getProviderEntities(context.projectDir);
      assertEquals(providers.length, 0);
    });
  });

  it("skips subdirectories", async () => {
    await withTestContext("entity-providers-subdir", async (context) => {
      const providersDir = join(context.projectDir, "providers");
      const subDir = join(providersDir, "subdir");
      await Deno.mkdir(subDir, { recursive: true });

      await createTestFile(
        join(subDir, "SubProvider.tsx"),
        `export default function SubProvider() { /* empty */ }`,
      );

      await createTestFile(
        join(providersDir, "MainProvider.tsx"),
        `export default function MainProvider() { /* empty */ }`,
      );

      const providers = await getProviderEntities(context.projectDir);
      assertEquals(providers.length, 1);
      assertEquals(providers[0]?.entity.content.includes("MainProvider"), true);
    });
  });
});
