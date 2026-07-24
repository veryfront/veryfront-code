import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { dirname, join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { symlink } from "#veryfront/platform/compat/fs.ts";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
} from "../../../src/types/entities/getEntityInfo.ts";
import { createMockAdapter } from "../../../src/platform/adapters/mock.ts";
import { VeryfrontError } from "../../../src/errors/types.ts";
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

async function assertRouteConflict(operation: () => Promise<unknown>): Promise<void> {
  const error = await assertRejects(operation, VeryfrontError);
  if (!(error instanceof VeryfrontError)) {
    throw new Error("Expected a VeryfrontError route conflict");
  }
  assertEquals(error.slug, "route-conflict");
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

  it("propagates adapter failures without falling through to the host filesystem", async () => {
    await withTestContext("entity-adapter-isolation", async (context) => {
      const testFile = join(context.projectDir, "adapter-only.mdx");
      await createTestFile(testFile, "# Host filesystem content");

      const adapter = {
        fs: {
          stat: () => Promise.resolve({ isFile: true }),
          readFile: () => Promise.reject(new Error("adapter read failed")),
        },
      } as unknown as RuntimeAdapter;

      await assertRejects(
        () => getEntityInfo(testFile, adapter),
        Error,
        "adapter read failed",
      );
    });
  });

  it("extracts entity metadata from Windows-style paths", async () => {
    const windowsPath = "C:\\project\\pages\\about.mdx";
    const adapter = {
      fs: {
        stat: () => Promise.resolve({ isFile: true }),
        readFile: () => Promise.resolve("# About"),
      },
    } as unknown as RuntimeAdapter;

    const info = await getEntityInfo(windowsPath, adapter);

    assertExists(info);
    assertEquals(info.entity.slug, "about");
    assertEquals(info.entity.type, "page");
    assertEquals(info.entity.isPage, true);
  });

  it("leaves hosted filesystem path normalization to the adapter", async () => {
    const projectDir = "/workspace/pages/project";
    const filePath = `${projectDir}/pages/about.mdx`;
    const reads: string[] = [];
    const entityLookups: string[] = [];
    const normalize = (path: string): string =>
      path.startsWith(projectDir) ? path.slice(projectDir.length).replace(/^\/+/, "") : path;
    const underlyingAdapter = {
      getEntityIdForPath(path: string): string {
        const normalized = normalize(path);
        entityLookups.push(normalized);
        return `id:${normalized}`;
      },
    };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        readFile: (path: string) => {
          reads.push(normalize(path));
          return Promise.resolve("# About");
        },
      },
    } as unknown as RuntimeAdapter;

    const info = await getEntityInfo(filePath, adapter);

    assertExists(info);
    assertEquals(reads, ["pages/about.mdx"]);
    assertEquals(entityLookups, ["pages/about.mdx"]);
    assertEquals(info.entity.id, "id:pages/about.mdx");
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

  it("rejects non-record YAML roots as frontmatter", async () => {
    await withTestContext("entity-frontmatter-root", async (context) => {
      const testFile = join(context.projectDir, "array-frontmatter.mdx");
      await createTestFile(
        testFile,
        `---
- private
- draft
---
# Content`,
      );

      const info = await getEntityInfo(testFile);

      assertExists(info);
      assertEquals(info.entity.frontmatter, {});
      assertEquals(info.entity.content, "# Content");
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

  it("does not bridge a virtual adapter failure into the host filesystem", async () => {
    await withTestContext("entity-virtual-adapter-authority", async (context) => {
      const testFile = join(context.projectDir, "remote-only.mdx");
      await createTestFile(testFile, "# Host content must not be returned");

      const adapter = createMockAdapter();
      Object.assign(adapter.fs, {
        getAdapterType: () => "GitHubFSAdapter",
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        isVeryfrontAdapter: () => false,
      });
      const backendError = new Error("virtual backend unavailable");
      adapter.fs.stat = () => Promise.reject(backendError);

      const error = await assertRejects(() => getEntityInfo(testFile, adapter), Error);

      assertEquals(error, backendError);
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

      const relativeInfo = await getEntityBySlug(context.projectDir, "./about");
      assertExists(relativeInfo);
      assertEquals(relativeInfo.entity.content.includes("# About"), true);
    });
  });

  it("does not resolve slugs outside the pages directory", async () => {
    await withTestContext("entity-byslug-traversal", async (context) => {
      await createTestFile(join(context.projectDir, "outside.mdx"), "# Outside");

      assertEquals(
        await getEntityBySlug(context.projectDir, "../outside"),
        null,
      );
      assertEquals(
        await getEntityBySlug(context.projectDir, "nested/../../outside"),
        null,
      );
      assertEquals(
        await getEntityBySlug(context.projectDir, "..\\outside"),
        null,
      );
    });
  });

  it("rejects pages directories that escape the project", async () => {
    await withTestContext("entity-pages-directory-traversal", async (context) => {
      const projectDir = join(context.projectDir, "project");
      await mkdir(projectDir, { recursive: true });
      await createTestFile(
        join(context.projectDir, "outside", "secret.mdx"),
        "# Outside",
      );

      assertEquals(
        await getEntityBySlug(projectDir, "secret", undefined, "../outside"),
        null,
      );
    });
  });

  it("does not follow page symlinks outside the project", async () => {
    await withTestContext("entity-page-symlink", async (context) => {
      const projectDir = join(context.projectDir, "project");
      const outsideFile = join(context.projectDir, "outside.mdx");
      const linkedPage = join(projectDir, "pages", "linked.mdx");
      await createTestFile(outsideFile, "# Outside");
      await mkdir(dirname(linkedPage), { recursive: true });
      await symlink(outsideFile, linkedPage);

      assertEquals(await getEntityBySlug(projectDir, "linked"), null);
    });
  });

  it("does not follow a pages directory symlink outside the project", async () => {
    await withTestContext("entity-pages-directory-symlink", async (context) => {
      const projectDir = join(context.projectDir, "project");
      const outsidePages = join(context.projectDir, "outside-pages");
      await mkdir(projectDir, { recursive: true });
      await createTestFile(join(outsidePages, "secret.mdx"), "# Outside");
      await symlink(outsidePages, join(projectDir, "pages"));

      assertEquals(await getEntityBySlug(projectDir, "secret"), null);
    });
  });

  it("rejects absolute paths returned outside an adapter project root", async () => {
    const adapter = {
      fs: {
        resolveFile: () => Promise.resolve("/tenant-b/secret.mdx"),
        stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
        readFile: () => Promise.resolve("# Tenant B"),
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    assertEquals(await getEntityBySlug("/tenant-a", "secret", adapter), null);
  });

  it("accepts project-relative paths from virtual filesystem adapters", async () => {
    const underlyingAdapter = {};
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
        resolveFile: () => Promise.resolve("pages/about.mdx"),
        stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
        readFile: () => Promise.resolve("# About"),
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    const info = await getEntityBySlug("/project", "about", adapter);

    assertExists(info);
    assertEquals(info.entity.content, "# About");
  });

  it("reads a root index candidate once", async () => {
    const underlyingAdapter = {};
    let readCount = 0;
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
        stat: (path: string) =>
          Promise.resolve({
            isFile: path.endsWith("/pages/index.mdx"),
            isDirectory: false,
          }),
        readFile: () => {
          readCount++;
          return Promise.resolve("# Home");
        },
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    const info = await getEntityBySlug("/project", "index", adapter);

    assertExists(info);
    assertEquals(info.entity.content, "# Home");
    assertEquals(readCount, 1);
  });

  it("resolves an explicit index base once", async () => {
    const underlyingAdapter = {};
    let resolveCount = 0;
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
        resolveFile: () => {
          resolveCount++;
          return Promise.resolve("pages/index.mdx");
        },
        stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
        readFile: () => Promise.resolve("# Home"),
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    const info = await getEntityBySlug("/project", "index", adapter);

    assertExists(info);
    assertEquals(info.entity.content, "# Home");
    assertEquals(resolveCount, 1);
  });

  it("fails closed when an adapter cannot canonicalize local paths", async () => {
    let readCount = 0;
    const adapter = {
      fs: {
        resolveFile: () => Promise.resolve("/project/pages/linked.mdx"),
        stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
        readFile: () => {
          readCount++;
          return Promise.resolve("# Outside through symlink");
        },
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    assertEquals(await getEntityBySlug("/project", "linked", adapter), null);
    assertEquals(readCount, 0);
  });

  it("resolves page names that contain layout", async () => {
    await withTestContext("entity-layout-page-name", async (context) => {
      await createTestFile(
        join(context.projectDir, "pages", "layout-guide.mdx"),
        "# Layout guide",
      );

      const info = await getEntityBySlug(context.projectDir, "layout-guide");

      assertExists(info);
      assertEquals(info.entity.type, "page");
      assertEquals(info.entity.content, "# Layout guide");
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

  it("matches dynamic pages according to segment arity", async () => {
    await withTestContext("entity-slug-dynamic-arity", async (context) => {
      const pagesDir = join(context.projectDir, "pages");
      await createTestFile(join(pagesDir, "blog", "[slug].mdx"), "# Single segment");
      await createTestFile(join(pagesDir, "docs", "[...slug].mdx"), "# Catch all");
      await createTestFile(
        join(pagesDir, "optional", "[[...slug]].mdx"),
        "# Optional catch all",
      );

      const single = await getEntityBySlug(context.projectDir, "blog/one");
      assertExists(single);
      assertEquals(single.entity.content, "# Single segment");
      assertEquals(
        await getEntityBySlug(context.projectDir, "blog/one/two"),
        null,
      );

      const catchAll = await getEntityBySlug(context.projectDir, "docs/one/two");
      assertExists(catchAll);
      assertEquals(catchAll.entity.content, "# Catch all");
      assertEquals(await getEntityBySlug(context.projectDir, "docs"), null);

      const optionalBase = await getEntityBySlug(context.projectDir, "optional");
      assertExists(optionalBase);
      assertEquals(optionalBase.entity.content, "# Optional catch all");

      const optionalNested = await getEntityBySlug(
        context.projectDir,
        "optional/one/two",
      );
      assertExists(optionalNested);
      assertEquals(optionalNested.entity.content, "# Optional catch all");
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

  it("preserves dynamic precedence after eighteen static segments", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    const prefix = Array.from({ length: 18 }, (_, index) => `segment-${index}`);
    const parentDir = join(projectDir, "pages", ...prefix);
    adapter.fs.files.set(
      join(parentDir, "[...all].tsx"),
      "// lower-priority catch-all",
    );
    adapter.fs.files.set(
      join(parentDir, "[id].tsx"),
      "// higher-priority dynamic segment",
    );

    const info = await getEntityBySlug(
      projectDir,
      [...prefix, "post"].join("/"),
      adapter,
    );

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

  it("reports equally specific dynamic routes as a structured conflict", async () => {
    const adapter = createMockAdapter();
    const projectDir = "/project";
    adapter.fs.files.set(join(projectDir, "pages", "[id].tsx"), "// id route");
    adapter.fs.files.set(join(projectDir, "pages", "[slug].tsx"), "// slug route");

    await assertRouteConflict(() => getEntityBySlug(projectDir, "post", adapter));
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

      const relativeLayout = await getLayoutEntity(
        context.projectDir,
        "./components/layouts/DefaultLayout.mdx",
      );
      assertExists(relativeLayout);
      assertEquals(relativeLayout.entity.isLayout, true);
    });
  });

  it("does not resolve layout names outside layout directories", async () => {
    await withTestContext("entity-layout-traversal", async (context) => {
      await mkdir(join(context.projectDir, "layouts"), { recursive: true });
      await createTestFile(
        join(context.projectDir, "RootLayout.mdx"),
        `---
isLayout: true
---
Root layout`,
      );

      assertEquals(
        await getLayoutEntity(context.projectDir, "../RootLayout"),
        null,
      );
      assertEquals(
        await getLayoutEntity(context.projectDir, "..\\RootLayout"),
        null,
      );
    });
  });
});
