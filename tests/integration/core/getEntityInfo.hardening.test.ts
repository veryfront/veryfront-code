import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { CloudflareFileSystemAdapter } from "#veryfront/platform/adapters/runtime/cloudflare/filesystem.ts";
import type { KVNamespace } from "#veryfront/platform/adapters/runtime/cloudflare/types.ts";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
} from "#veryfront/types/entities/getEntityInfo.ts";

async function assertRouteConflict(operation: () => Promise<unknown>): Promise<void> {
  const error = await assertRejects(operation, VeryfrontError);
  if (!(error instanceof VeryfrontError)) {
    throw new Error("Expected a VeryfrontError route conflict");
  }
  assertEquals(error.slug, "route-conflict");
}

function createCloudflareKV(initialEntries: Record<string, string>): KVNamespace {
  const entries = new Map(Object.entries(initialEntries));
  return {
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(entries.get(key) ?? null);
    },
    getWithMetadata(key) {
      return Promise.resolve({ metadata: null, value: entries.get(key) ?? null });
    },
    list(options = {}) {
      const prefix = options.prefix ?? "";
      return Promise.resolve({
        keys: [...entries.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
      });
    },
    put(key, value) {
      entries.set(key, value);
      return Promise.resolve();
    },
  };
}

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

  it("does not invoke an accessor masquerading as the optional entity identifier hook", async () => {
    let accessorReads = 0;
    const underlyingAdapter = Object.defineProperty({}, "getEntityIdForPath", {
      configurable: true,
      get() {
        accessorReads++;
        throw new Error("entity identifier accessor must not run");
      },
    });
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
    assertEquals(result.entity.id, "pages/page.mdx");
    assertEquals(accessorReads, 0);
  });

  it("propagates failures while inspecting the authoritative entity identifier hook", async () => {
    const underlyingAdapter = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("entity identifier hook inspection failed");
      },
    });
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityInfo("pages/page.mdx", adapter),
      Error,
      "entity identifier hook inspection failed",
    );
  });

  it("rejects hosted entity identifiers containing control characters", async () => {
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({
          getEntityIdForPath: () => "entity\nidentifier",
        }),
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    const error = await assertRejects(
      () => getEntityInfo("/project/pages/page.mdx", adapter),
      VeryfrontError,
    );
    if (!(error instanceof VeryfrontError)) {
      throw new Error("Expected a VeryfrontError for an invalid entity identifier");
    }
    assertEquals(error.slug, "invalid-route-file");
  });

  it("preserves an unreadable adapter rejection without reclassifying it", async () => {
    const rejection = new Proxy({}, {
      get() {
        throw new Error("adapter rejection must not be inspected");
      },
    });
    const adapter = createMockAdapter();
    adapter.fs.stat = () => Promise.reject(rejection);

    let caught: unknown;
    try {
      await getEntityInfo("/project/pages/page.mdx", adapter);
    } catch (error) {
      caught = error;
    }

    assertEquals(caught === rejection, true);
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
  it("supports Cloudflare KV containment without allowing resolved path escapes", async () => {
    const fs = new CloudflareFileSystemAdapter(createCloudflareKV({
      "/outside/secret.mdx": "# Secret",
      "/project/pages/about.mdx": "# About",
    }));
    const adapter: RuntimeAdapter = {
      ...createMockAdapter(),
      id: "cloudflare",
      fs,
    };

    const page = await getEntityBySlug("/project", "about", adapter);
    assertEquals(page?.entity.content, "# About");

    Object.assign(fs, {
      resolveFile: () => Promise.resolve("/outside/secret.mdx"),
    });
    assertEquals(await getEntityBySlug("/project", "secret", adapter), null);
  });

  it("resolves relative Cloudflare KV projects from the canonical virtual root", async () => {
    const fs = new CloudflareFileSystemAdapter(createCloudflareKV({
      "pages/about.mdx": "# Relative about",
    }));
    const adapter: RuntimeAdapter = {
      ...createMockAdapter(),
      id: "cloudflare",
      fs,
    };

    const page = await getEntityBySlug(".", "about", adapter);

    assertEquals(page?.entity.content, "# Relative about");
    assertEquals(page?.entity.slug, "about");
  });

  it("normalizes adapter-resolved dot segments and backslashes before KV reads", async () => {
    const fs = new CloudflareFileSystemAdapter(createCloudflareKV({
      "/project/pages/about.mdx": "# Canonical about",
    }));
    Object.assign(fs, {
      resolveFile: (path: string) =>
        Promise.resolve(
          path.endsWith("/pages/about") ? "/project\\pages\\.\\about.mdx" : null,
        ),
    });
    const adapter: RuntimeAdapter = {
      ...createMockAdapter(),
      id: "cloudflare",
      fs,
    };

    const page = await getEntityBySlug("/project", "about", adapter);

    assertEquals(page?.entity.content, "# Canonical about");
    assertEquals(page?.entity.slug, "about");
  });

  it("propagates an immediate root canonicalization failure before touching candidates", async () => {
    const rootFailure = new Error("root backend unavailable immediately");
    const adapter = createMockAdapter();
    let candidateCalls = 0;
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(path.endsWith("/pages/about") ? `${path}.mdx` : null);
    adapter.fs.realPath = (path: string) => {
      if (path === "/project") return Promise.reject(rootFailure);
      candidateCalls++;
      return Promise.reject(new Error("candidate failure must not win"));
    };

    const error = await assertRejects(
      () => getEntityBySlug("/project", "about", adapter),
      Error,
      rootFailure.message,
    );

    assertEquals(error === rootFailure, true);
    assertEquals(candidateCalls, 0);
  });

  it("propagates a deferred root canonicalization failure before touching candidates", async () => {
    const rootFailure = new Error("root backend unavailable after a turn");
    const adapter = createMockAdapter();
    let candidateCalls = 0;
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(path.endsWith("/pages/about") ? `${path}.mdx` : null);
    adapter.fs.realPath = async (path: string) => {
      if (path === "/project") {
        await Promise.resolve();
        throw rootFailure;
      }
      candidateCalls++;
      throw new Error("candidate failure must not win");
    };

    const error = await assertRejects(
      () => getEntityBySlug("/project", "about", adapter),
      Error,
      rootFailure.message,
    );

    assertEquals(error === rootFailure, true);
    assertEquals(candidateCalls, 0);
  });

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

  it("reports ambiguous dynamic pages at the same route depth", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[id].mdx"), "# ID page");
      await writeTextFile(join(pagesDir, "[slug].mdx"), "# Slug page");

      await assertRouteConflict(() => getEntityBySlug(projectDir, "blog/entry"));
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

  it("does not treat extra filename suffixes as dynamic route syntax", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[slug].draft.mdx"), "# Draft");

      assertEquals(await getEntityBySlug(projectDir, "entry"), null);
    });
  });

  it("reports duplicate exact page definitions", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "about.mdx"), "# MDX page");
      await writeTextFile(join(pagesDir, "about.tsx"), "export default function About() {}");

      await assertRouteConflict(() => getEntityBySlug(projectDir, "about"));
    });
  });

  it("reports duplicate exact pages hidden by adapter extension priority", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/about.mdx", "# MDX page");
    adapter.fs.files.set(
      "/project/pages/about.tsx",
      "export default function About() {}",
    );
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(
        path.endsWith("/pages/about") ? "/project/pages/about.mdx" : null,
      );

    await assertRouteConflict(() => getEntityBySlug("/project", "about", adapter));
  });

  it("reports case-variant duplicate extensions returned by adapter directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/about.mdx", "# Lowercase extension");
    adapter.fs.files.set("/project/pages/about.MDX", "# Uppercase extension");
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(
        path.endsWith("/pages/about") ? "/project/pages/about.mdx" : null,
      );

    await assertRouteConflict(() => getEntityBySlug("/project", "about", adapter));
  });

  it("deduplicates repeated adapter directory entries deterministically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/about.mdx", "# About");
    adapter.fs.resolveFile = () => Promise.resolve("/project/pages/about.mdx");
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      const entry = {
        name: "about.mdx",
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      };
      yield entry;
      yield { ...entry };
    };

    const result = await getEntityBySlug("/project", "about", adapter);

    assertEquals(result?.entity.content, "# About");
  });

  it("preserves adapter directory errors during exact-page discovery", async () => {
    const backendFailure = new Error("directory backend unavailable");
    const adapter = createMockAdapter();
    let resolveCalls = 0;
    adapter.fs.resolveFile = (path: string) => {
      resolveCalls++;
      return Promise.resolve(
        path.endsWith("/pages/about") ? "/project/pages/about.mdx" : null,
      );
    };
    adapter.fs.readDir = () => {
      throw backendFailure;
    };

    const error = await assertRejects(
      () => getEntityBySlug("/project", "about", adapter),
      Error,
      backendFailure.message,
    );

    assertEquals(error === backendFailure, true);
    assertEquals(resolveCalls, 1);
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
    const underlyingAdapter = {};
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
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
    const adapter = createMockAdapter();
    let statCalls = 0;
    adapter.fs.stat = () => {
      statCalls++;
      return Promise.reject(new Error("filesystem must not be reached"));
    };

    assertEquals(
      await getEntityBySlug("/project", "x".repeat(4_097), adapter),
      null,
    );
    assertEquals(statCalls, 0);
  });

  it("rejects route controls before filesystem access", async () => {
    const adapter = createMockAdapter();
    let statCalls = 0;
    adapter.fs.stat = () => {
      statCalls++;
      return Promise.reject(new Error("filesystem must not be reached"));
    };

    assertEquals(await getEntityBySlug("/project", "safe\nroute", adapter), null);
    assertEquals(statCalls, 0);
  });

  it("rejects composed candidate paths beyond the path boundary", async () => {
    const adapter = createMockAdapter();
    let resolveCalls = 0;
    let statCalls = 0;
    adapter.fs.resolveFile = () => {
      resolveCalls++;
      return Promise.resolve(null);
    };
    adapter.fs.stat = () => {
      statCalls++;
      return Promise.reject(new Error("filesystem must not be reached"));
    };

    assertEquals(
      await getEntityBySlug(
        `/${"p".repeat(3_000)}`,
        "page",
        adapter,
        "d".repeat(1_500),
      ),
      null,
    );
    assertEquals(resolveCalls, 0);
    assertEquals(statCalls, 0);
  });

  it("rejects overlong canonical paths returned by an adapter", async () => {
    const adapter = createMockAdapter();
    let statCalls = 0;
    adapter.fs.realPath = () => Promise.resolve(`/${"x".repeat(4_097)}`);
    adapter.fs.stat = () => {
      statCalls++;
      return Promise.reject(new Error("filesystem must not be reached"));
    };

    assertEquals(await getEntityBySlug("/project", "page", adapter), null);
    assertEquals(statCalls, 0);
  });

  it("snapshots adapter directory entries before asynchronous mutation", async () => {
    const underlyingAdapter = {};
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
        getAdapterType: () => "GitHubFSAdapter",
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

  it("rejects unsafe and structurally impossible directory entries", async () => {
    const createAdapter = (entry: unknown): RuntimeAdapter => {
      const underlyingAdapter = {};
      return {
        fs: {
          isVeryfrontAdapter: () => false,
          getUnderlyingAdapter: () => underlyingAdapter,
          isMultiProjectMode: () => false,
          getAdapterType: () => "GitHubFSAdapter",
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

    assertEquals(
      await getEntityBySlug(
        "/project",
        "entry",
        createAdapter({
          name: "[slug]\n.mdx",
          isFile: true,
          isDirectory: false,
        }),
      ),
      null,
    );

    assertEquals(
      await getEntityBySlug(
        "/project",
        "entry",
        createAdapter({
          name: `[${"x".repeat(4_097)}].mdx`,
          isFile: true,
          isDirectory: false,
        }),
      ),
      null,
    );

    await assertRejects(
      () =>
        getEntityBySlug(
          "/project",
          "entry",
          createAdapter({
            name: "[slug].mdx",
            isFile: true,
            isDirectory: true,
          }),
        ),
      Error,
      "invalid directory entry",
    );
  });

  it("bounds adapter directory iteration", async () => {
    const underlyingAdapter = {};
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
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

  it("charges invalid entries against the global dynamic traversal budget", async () => {
    const adapter = {
      id: "memory",
      fs: {
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
          for (let index = 0; index < 9_999; index++) {
            yield {
              name: "..",
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            };
          }
          yield {
            name: "[segment]",
            isFile: false,
            isDirectory: true,
            isSymlink: false,
          };
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => getEntityBySlug("/project", Array(11).fill("part").join("/"), adapter),
      Error,
      "100000-entry limit",
    );
  });

  it("bounds dynamic directory traversal across one route lookup", async () => {
    const underlyingAdapter = {};
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
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

  it("applies the layouts-directory convention to explicit file paths", async () => {
    await withTempDir(async (projectDir) => {
      const layoutPath = join(projectDir, "layouts", "main.mdx");
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(layoutPath, "# Main layout");

      const result = await getLayoutEntity(projectDir, "layouts/main.mdx");

      assertExists(result);
      assertEquals(result.entity.type, "layout");
      assertEquals(result.entity.content, "# Main layout");
    });
  });

  it("does not apply the layout convention to explicit page paths", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "pages", "main.mdx");
      await mkdir(join(projectDir, "pages"), { recursive: true });
      await writeTextFile(pagePath, "# Main page");

      assertEquals(
        await getLayoutEntity(projectDir, "pages/main.mdx"),
        null,
      );
    });
  });

  it("reports duplicate layout definitions", async () => {
    await withTempDir(async (projectDir) => {
      const layoutsDirectory = join(projectDir, "layouts");
      await mkdir(layoutsDirectory, { recursive: true });
      await writeTextFile(join(layoutsDirectory, "main.mdx"), "# MDX layout");
      await writeTextFile(join(layoutsDirectory, "main.tsx"), "export default () => null;");

      await assertRouteConflict(() => getLayoutEntity(projectDir, "main"));
    });
  });
});
