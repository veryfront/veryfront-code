import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { getEntityBySlug, getEntityInfo, getLayoutEntity } from "./getEntityInfo.ts";

describe("getEntityInfo", () => {
  it("removes invalid values from typed frontmatter fields", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "page.mdx");
      await writeTextFile(
        pagePath,
        [
          "---",
          "title: 42",
          "tags:",
          "  - valid",
          "  - 7",
          "published: yes",
          "isLayout: yes",
          "custom:",
          "  nested: true",
          "---",
          "# Page",
        ].join("\n"),
      );

      const result = await getEntityInfo(pagePath);

      assertExists(result);
      assertEquals(result.entity.frontmatter.title, undefined);
      assertEquals(result.entity.frontmatter.tags, undefined);
      assertEquals(result.entity.frontmatter.published, undefined);
      assertEquals(result.entity.frontmatter.isLayout, undefined);
      assertEquals(result.entity.frontmatter.custom, { nested: true });
      assertEquals(result.entity.type, "page");
    });
  });

  it("propagates hosted adapter entity identifier failures", async () => {
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({
          getEntityIdForPath: () => {
            throw new Error("entity identifier lookup failed");
          },
        }),
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityInfo("/project/pages/page.mdx", adapter),
      Error,
      "entity identifier lookup failed",
    );
  });

  it("does not reinterpret entity identifier failures as missing files", async () => {
    const missingEntityId = Object.assign(
      new Error("entity identifier unavailable"),
      { code: "ENOENT" },
    );
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({
          getEntityIdForPath: () => {
            throw missingEntityId;
          },
        }),
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityInfo("/project/pages/page.mdx", adapter),
      Error,
      "entity identifier unavailable",
    );
  });

  it("preserves the hosted adapter receiver during entity identifier lookup", async () => {
    const underlyingAdapter = {
      prefix: "entity",
      getEntityIdForPath(path: string) {
        return `${this.prefix}:${path}`;
      },
    };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    const result = await getEntityInfo("pages/page.mdx", adapter);

    assertExists(result);
    assertEquals(result.entity.id, "entity:pages/page.mdx");
  });

  it("rejects entity sources beyond the bounded page-source limit", async () => {
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("x".repeat(5 * 1024 * 1024 + 1)),
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityInfo("/project/pages/page.mdx", adapter),
      Error,
      "source exceeds",
    );
  });

  it("normalizes slugs from case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "article.MDX");
      await writeTextFile(pagePath, "# Article");

      const result = await getEntityInfo(pagePath);

      assertExists(result);
      assertEquals(result.entity.slug, "article");
      assertEquals(result.entity.kind, "mdx");
    });
  });

  it("derives a complete route slug for nested case-insensitive index files", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "pages", "blog", "guides", "INDEX.MDX");
      await mkdir(join(projectDir, "pages", "blog", "guides"), { recursive: true });
      await writeTextFile(pagePath, "# Guides");

      const result = await getEntityInfo(pagePath);

      assertExists(result);
      assertEquals(result.entity.slug, "blog/guides");
    });
  });
});

describe("getEntityBySlug", () => {
  it("resolves dynamic pages with case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[slug].MDX"), "# Dynamic page");

      const result = await getEntityBySlug(projectDir, "blog/entry");

      assertExists(result);
      assertEquals(result.entity.slug, "blog/entry");
      assertEquals(result.entity.content, "# Dynamic page");
    });
  });

  it("rejects ambiguous dynamic pages at the same route depth", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[id].mdx"), "# ID page");
      await writeTextFile(join(pagesDir, "[slug].mdx"), "# Slug page");

      const error = await assertRejects(
        () => getEntityBySlug(projectDir, "blog/entry"),
      );

      assertEquals((error as { slug?: string }).slug, "route-conflict");
    });
  });

  it("resolves routes with consecutive dynamic path segments", async () => {
    await withTempDir(async (projectDir) => {
      const categoryDir = join(projectDir, "pages", "blog", "[category]");
      await mkdir(categoryDir, { recursive: true });
      await writeTextFile(join(categoryDir, "[slug].mdx"), "# Nested dynamic page");

      const result = await getEntityBySlug(projectDir, "blog/guides/getting-started");

      assertExists(result);
      assertEquals(result.entity.slug, "blog/guides/getting-started");
      assertEquals(result.entity.content, "# Nested dynamic page");
    });
  });

  it("ignores same-priority dynamic files that are not pages", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(
        join(pagesDir, "[layout].mdx"),
        "---\nisLayout: true\n---\n# Dynamic layout",
      );
      await writeTextFile(join(pagesDir, "[slug].mdx"), "# Dynamic page");

      const result = await getEntityBySlug(projectDir, "blog/entry");

      assertExists(result);
      assertEquals(result.entity.content, "# Dynamic page");
    });
  });

  it("rejects duplicate exact page definitions instead of using extension order", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "about.mdx"), "# MDX page");
      await writeTextFile(join(pagesDir, "about.tsx"), "export default function About() {}");

      const error = await assertRejects(
        () => getEntityBySlug(projectDir, "about"),
      );

      assertEquals((error as { slug?: string }).slug, "route-conflict");
    });
  });

  it("returns a canonical slug after resolving redundant path segments", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "about.mdx"), "# About");

      const result = await getEntityBySlug(projectDir, "//./about//");

      assertExists(result);
      assertEquals(result.entity.slug, "about");
    });
  });

  it("resolves directory index pages through adapter resolveFile", async () => {
    const underlyingAdapter = { [FS_ADAPTER_KIND]: "github" as const };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        resolveFile: (path: string) =>
          Promise.resolve(
            path.endsWith("/pages/about/index") ? "pages/about/index.mdx" : null,
          ),
        stat: () =>
          Promise.resolve({
            size: 7,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: null,
          }),
        readFile: () => Promise.resolve("# About"),
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    const result = await getEntityBySlug("/project", "about", adapter);

    assertExists(result);
    assertEquals(result.entity.slug, "about");
    assertEquals(result.entity.content, "# About");
  });

  it("rejects route slugs beyond the path boundary before filesystem access", async () => {
    await withTempDir(async (projectDir) => {
      assertEquals(
        await getEntityBySlug(projectDir, "x".repeat(4_097)),
        null,
      );
    });
  });

  it("snapshots adapter directory entries before asynchronous mutation", async () => {
    const underlyingAdapter = { [FS_ADAPTER_KIND]: "github" as const };
    const mutableEntry = {
      name: "[slug].mdx",
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        resolveFile: () => Promise.resolve(null),
        stat: (path: string) =>
          Promise.resolve({
            size: path.endsWith("/pages") ? 0 : 9,
            isFile: !path.endsWith("/pages"),
            isDirectory: path.endsWith("/pages"),
            isSymlink: false,
            mtime: null,
          }),
        readFile: () => Promise.resolve("# Dynamic"),
        readDir: async function* () {
          yield mutableEntry;
          mutableEntry.name = "changed.txt";
        },
      },
    } as unknown as RuntimeAdapter;

    const result = await getEntityBySlug("/project", "entry", adapter);

    assertExists(result);
    assertEquals(result.entity.content, "# Dynamic");
  });

  it("rejects accessor-backed and inherited adapter directory entries", async () => {
    const createAdapter = (entry: unknown): RuntimeAdapter => {
      const underlyingAdapter = { [FS_ADAPTER_KIND]: "github" as const };
      return {
        fs: {
          isVeryfrontAdapter: () => false,
          getUnderlyingAdapter: () => underlyingAdapter,
          isMultiProjectMode: () => false,
          resolveFile: () => Promise.resolve(null),
          stat: (path: string) =>
            Promise.resolve({
              size: path.endsWith("/pages") ? 0 : 9,
              isFile: !path.endsWith("/pages"),
              isDirectory: path.endsWith("/pages"),
              isSymlink: false,
              mtime: null,
            }),
          readFile: () => Promise.resolve("# Dynamic"),
          readDir: async function* () {
            yield entry;
          },
        },
      } as unknown as RuntimeAdapter;
    };

    let accessorReads = 0;
    const accessorEntry = Object.defineProperties({}, {
      name: {
        enumerable: true,
        get() {
          accessorReads++;
          return "[slug].mdx";
        },
      },
      isFile: { enumerable: true, value: true },
      isDirectory: { enumerable: true, value: false },
    });

    await assertRejects(
      () => getEntityBySlug("/project", "entry", createAdapter(accessorEntry)),
      Error,
      "invalid directory entry",
    );
    assertEquals(accessorReads, 0);

    const inheritedEntry = Object.create({
      name: "[slug].mdx",
      isFile: true,
      isDirectory: false,
    });
    await assertRejects(
      () => getEntityBySlug("/project", "entry", createAdapter(inheritedEntry)),
      Error,
      "invalid directory entry",
    );
  });

  it("bounds adapter directory iteration", async () => {
    const underlyingAdapter = { [FS_ADAPTER_KIND]: "github" as const };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        resolveFile: () => Promise.resolve(null),
        stat: () =>
          Promise.resolve({
            size: 0,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            mtime: null,
          }),
        readFile: () => Promise.resolve(""),
        readDir: async function* () {
          for (let index = 0; index <= 10_000; index++) {
            yield {
              name: `entry-${index}`,
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            };
          }
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityBySlug("/project", "entry", adapter),
      Error,
      "directory entries",
    );
  });

  it("bounds dynamic directory traversal across one route lookup", async () => {
    const underlyingAdapter = { [FS_ADAPTER_KIND]: "github" as const };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        resolveFile: () => Promise.resolve(null),
        stat: () =>
          Promise.resolve({
            size: 0,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            mtime: null,
          }),
        readFile: () => Promise.resolve(""),
        readDir: async function* (path: string) {
          if (!path.endsWith("/pages")) return;
          for (let index = 0; index <= 1_024; index++) {
            yield {
              name: `[segment${index}]`,
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            };
          }
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityBySlug("/project", "entry", adapter),
      Error,
      "directory traversal",
    );
  });
});

describe("getLayoutEntity", () => {
  it("resolves explicit layout paths with case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const layoutPath = join(projectDir, "components", "DefaultLayout.MDX");
      await mkdir(join(projectDir, "components"), { recursive: true });
      await writeTextFile(layoutPath, "---\nisLayout: true\n---\n# Default layout");

      const result = await getLayoutEntity(
        projectDir,
        "components/DefaultLayout.MDX",
      );

      assertExists(result);
      assertEquals(result.entity.isLayout, true);
      assertEquals(result.entity.content, "# Default layout");
    });
  });

  it("rejects duplicate layout definitions instead of relying on extension order", async () => {
    await withTempDir(async (projectDir) => {
      const layoutsDirectory = join(projectDir, "layouts");
      await mkdir(layoutsDirectory, { recursive: true });
      await writeTextFile(join(layoutsDirectory, "main.mdx"), "# MDX layout");
      await writeTextFile(join(layoutsDirectory, "main.tsx"), "export default () => null;");

      const error = await assertRejects(() => getLayoutEntity(projectDir, "main"));

      assertEquals((error as { slug?: string }).slug, "route-conflict");
    });
  });
});
