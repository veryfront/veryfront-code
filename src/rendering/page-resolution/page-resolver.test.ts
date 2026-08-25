import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageResolver } from "./page-resolver.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  clearRouterDetectionCacheForProject,
  primeRouterDetectionCache,
} from "#veryfront/rendering/router-detection.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

function fileNotFoundError(): Error {
  return Object.assign(new Error("File not found"), { code: "ENOENT" });
}

function virtualTextRead(readFile: (path: string) => Promise<string>) {
  return {
    symlinkSemantics: "none" as const,
    readFile,
    async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
      const bytes = new TextEncoder().encode(await readFile(path));
      if (bytes.byteLength > byteLimit) throw new RangeError("File exceeds byte limit");
      return bytes;
    },
  };
}

function createMockAdapter(
  dirEntries: Record<string, DirEntry[]> = {},
  existingDirs: string[] = [],
): RuntimeAdapter {
  return {
    id: "memory",
    fs: {
      ...virtualTextRead(async () => ""),
      exists: async (path: string) => existingDirs.includes(path),
      readDir: async function* (path: string) {
        const entries = dirEntries[path] ?? [];
        for (const entry of entries) {
          yield entry;
        }
      },
      writeFile: async () => {},
      mkdir: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createMockConfig(overrides: Partial<VeryfrontConfig> = {}): VeryfrontConfig {
  return {
    ...overrides,
  } as VeryfrontConfig;
}

/** An adapter whose project holds no routable file at all. */
function createEmptyProjectAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    fs: {
      ...virtualTextRead(() => Promise.reject(fileNotFoundError())),
      resolveFile: async () => null,
      stat: async () => {
        throw fileNotFoundError();
      },
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

describe("rendering/page-resolution/page-resolver", () => {
  describe("PageResolver constructor", () => {
    it("should create a resolver with required options", () => {
      const adapter = createMockAdapter();
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      assertEquals(resolver instanceof PageResolver, true);
    });

    it("should accept optional projectId", async () => {
      // The router-detection cache is keyed by projectId, so a primed entry is
      // the observable proof that the constructor kept the identity.
      const adapter = createMockAdapter(
        {
          "/project": [{ name: "pages", isFile: false, isDirectory: true }],
          "/project/pages": [],
        },
        ["/project/pages"],
      );
      const config = createMockConfig();
      clearRouterDetectionCacheForProject("my-project");
      clearRouterDetectionCacheForProject("/project");
      primeRouterDetectionCache("my-project", "app");

      try {
        const resolver = new PageResolver({
          projectDir: "/project",
          projectId: "my-project",
          config,
          adapter,
        });
        assertEquals(
          await resolver.getRouterMode(),
          "app",
          "projectId must key the router-detection cache",
        );

        const withoutProjectId = new PageResolver({
          projectDir: "/project",
          config,
          adapter,
        });
        assertEquals(
          await withoutProjectId.getRouterMode(),
          "pages",
          "a resolver without projectId must not read another project's primed detection",
        );
      } finally {
        clearRouterDetectionCacheForProject("my-project");
        clearRouterDetectionCacheForProject("/project");
      }
    });
  });

  describe("resolvePage", () => {
    it("resolves static and dynamic pages from the configured pages directory", async () => {
      const files = new Map([
        ["/project/src/content/index.tsx", "export default function Page() { return null; }"],
        ["/project/src/content/[slug].tsx", "export default function Page() { return null; }"],
      ]);
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            const source = files.get(path);
            if (source === undefined) throw fileNotFoundError();
            return source;
          }),
          resolveFile: async (path: string) => {
            if (path === "/project/src/content/index") {
              return "/project/src/content/index.tsx";
            }
            return null;
          },
          stat: async (path: string) => {
            if (files.has(path)) {
              return { isFile: true, isDirectory: false, isSymlink: false };
            }
            if (path === "/project/src/content") {
              return { isFile: false, isDirectory: true, isSymlink: false };
            }
            throw fileNotFoundError();
          },
          exists: async (path: string) => path === "/project/src/content",
          readDir: async function* (path: string) {
            if (path === "/project/src/content") {
              yield { name: "index.tsx", isFile: true, isDirectory: false };
              yield { name: "[slug].tsx", isFile: true, isDirectory: false };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;
      const resolver = new PageResolver({
        projectDir: "/project",
        config: createMockConfig({
          router: "pages",
          directories: { pages: "src/content" },
        }),
        adapter,
      });

      const root = await resolver.resolvePage("/");
      const dynamic = await resolver.resolvePage("article");

      assertEquals(root.entity.path, "/project/src/content/index.tsx");
      assertEquals(root.entity.slug, "");
      assertEquals(dynamic.entity.path, "/project/src/content/[slug].tsx");
      assertEquals(dynamic.entity.slug, "article");
    });

    it("resolves dynamic App Router pages without remote stat misses", async () => {
      let statCalls = 0;
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            if (path === "/project/app/[slug]/page.tsx") {
              return "export default function Page() { return null; }";
            }
            throw fileNotFoundError();
          }),
          resolveFile: async () => null,
          stat: async () => {
            statCalls++;
            throw fileNotFoundError();
          },
          readDir: async function* (path: string) {
            if (path === "/project/app") {
              yield { name: "[slug]", isFile: false, isDirectory: true };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;
      const resolver = new PageResolver({
        projectDir: "/project",
        config: createMockConfig({ router: "app" }),
        adapter,
      });

      const page = await resolver.resolvePage("article");

      assertEquals(page.entity.path, "/project/app/[slug]/page.tsx");
      assertEquals(statCalls, 0);
    });

    it("propagates an App Router resolution deadline through active adapter work", async () => {
      let releaseResolveFile!: (path: string | null) => void;
      const blockedResolveFile = new Promise<string | null>((resolve) => {
        releaseResolveFile = resolve;
      });
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(() => Promise.resolve("# Page")),
          resolveFile: () => blockedResolveFile,
          readDir: async function* () {},
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "app-timeout-project",
        config: createMockConfig({ router: "app" }),
        adapter,
      });

      await assertRejects(
        () =>
          resolver.resolvePage("", {
            deadline: Date.now() + 50,
          }),
        Error,
        "deadline",
      );

      releaseResolveFile(null);
      await Promise.resolve();
    });

    it("propagates a resolution deadline while auto router detection is active", async () => {
      let releaseDirectoryReads!: () => void;
      const directoryReadsReleased = new Promise<void>((resolve) => {
        releaseDirectoryReads = resolve;
      });
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(() => Promise.resolve("# Page")),
          resolveFile: async () => null,
          readDir: () => ({
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  await directoryReadsReleased;
                  return { done: true as const, value: undefined };
                },
              };
            },
          }),
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "auto-timeout-project",
        config: createMockConfig(),
        adapter,
      });

      const request = resolver.resolvePage("article", {
        deadline: Date.now() + 50,
      });
      let pendingTimer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        request.then(
          () => "resolved" as const,
          (error) =>
            error instanceof Error && error.message.includes("deadline")
              ? "deadline" as const
              : "other-error" as const,
        ),
        new Promise<"still-pending">((resolve) => {
          pendingTimer = setTimeout(() => resolve("still-pending"), 200);
        }),
      ]);
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
      releaseDirectoryReads();
      await request.catch(() => undefined);

      assertEquals(outcome, "deadline");
    });

    it("resolves optional catch-all App Router pages across remaining segments", async () => {
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            if (path === "/project/app/[[...slug]]/page.tsx") {
              return "export default function Page() { return null; }";
            }
            throw fileNotFoundError();
          }),
          resolveFile: async () => null,
          readDir: async function* (path: string) {
            if (path === "/project/app") {
              yield { name: "[[...slug]]", isFile: false, isDirectory: true };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;
      const resolver = new PageResolver({
        projectDir: "/project",
        config: createMockConfig({ router: "app" }),
        adapter,
      });

      const page = await resolver.resolvePage("guides/platform/agents");

      assertEquals(page.entity.path, "/project/app/[[...slug]]/page.tsx");
    });

    it("keeps auto router detection aligned with the structural app router", async () => {
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            if (path === "/project/app/page.tsx") {
              return "export default function Page() { return null; }";
            }
            throw fileNotFoundError();
          }),
          resolveFile: async (path: string) => {
            if (path === "/project/app/page") {
              return "/project/app/page.tsx";
            }
            return null;
          },
          stat: async (path: string) => {
            if (path === "/project/app") {
              return {
                isFile: false,
                isDirectory: true,
                isSymlink: false,
              };
            }
            throw fileNotFoundError();
          },
          exists: async (path: string) => path === "/project/app",
          readDir: async function* (path: string) {
            if (path === "/project/app") {
              yield { name: "page.tsx", isFile: true, isDirectory: false };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;

      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "project-1",
        config,
        adapter,
      });

      const page = await resolver.resolvePage("/");
      const routerMode = await resolver.getRouterMode();

      assertEquals(page.entity.path, "/project/app/page.tsx");
      assertEquals(routerMode, "app");
    });

    it("falls back to pages router when app routes are absent", async () => {
      const resolveCalls: string[] = [];
      const readCalls: string[] = [];
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            readCalls.push(path);
            if (path === "/project/pages/index.tsx") {
              return "export default function Page() { return null; }";
            }
            throw fileNotFoundError();
          }),
          resolveFile: async (path: string) => {
            resolveCalls.push(path);
            if (path === "/project/app/page") {
              return null;
            }
            if (path === "/project/pages/index") {
              return "/project/pages/index.tsx";
            }
            return null;
          },
          stat: async (path: string) => {
            if (path === "/project/pages/index.tsx") {
              return {
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            }
            if (path === "/project/pages") {
              return {
                isFile: false,
                isDirectory: true,
                isSymlink: false,
              };
            }
            throw fileNotFoundError();
          },
          exists: async (path: string) => path === "/project/pages",
          readDir: async function* (path: string) {
            if (path === "/project") {
              yield { name: "pages", isFile: false, isDirectory: true };
            } else if (path === "/project/pages") {
              yield { name: "index.tsx", isFile: true, isDirectory: false };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;

      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "project-switch",
        config,
        adapter,
      });

      const page = await resolver.resolvePage("/");
      const routerMode = await resolver.getRouterMode();

      assertEquals(page.entity.path, "/project/pages/index.tsx");
      assertEquals(routerMode, "pages");
      assertEquals(resolveCalls.includes("/project/app/page"), false);
      assertEquals(readCalls.some((path) => path.startsWith("/project/app")), false);
    });

    it("does not poison auto router detection from a pages fallback", async () => {
      const adapter = {
        id: "memory",
        fs: {
          ...virtualTextRead(async (path: string) => {
            if (path === "/project/pages/index.tsx") {
              return "export default function Page() { return null; }";
            }
            throw fileNotFoundError();
          }),
          resolveFile: async (path: string) => {
            if (path === "/project/app/page") {
              return null;
            }
            if (path === "/project/pages/index") {
              return "/project/pages/index.tsx";
            }
            return null;
          },
          stat: async (path: string) => {
            if (path === "/project/pages/index.tsx") {
              return {
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            }
            if (path === "/project/app" || path === "/project/pages") {
              return {
                isFile: false,
                isDirectory: true,
                isSymlink: false,
              };
            }
            throw fileNotFoundError();
          },
          exists: async (path: string) => path === "/project/app" || path === "/project/pages",
          readDir: async function* (path: string) {
            if (path === "/project/app") {
              yield { name: "dashboard", isFile: false, isDirectory: true };
              return;
            }

            if (path === "/project/app/dashboard") {
              yield { name: "page.tsx", isFile: true, isDirectory: false };
              return;
            }

            if (path === "/project/pages") {
              yield { name: "index.tsx", isFile: true, isDirectory: false };
            }
          },
          writeFile: async () => {},
          mkdir: async () => {},
        },
        env: { get: () => undefined },
      } as unknown as RuntimeAdapter;

      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "mixed-project",
        config,
        adapter,
      });

      const page = await resolver.resolvePage("/");
      const routerMode = await resolver.getRouterMode();

      assertEquals(page.entity.path, "/project/pages/index.tsx");
      assertEquals(routerMode, "app");
    });
  });

  describe("resolvePage failures", () => {
    it("raises the registry file-not-found identity for an unknown slug", async () => {
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "missing-app",
        config: createMockConfig({ router: "app" } as any),
        adapter: createEmptyProjectAdapter(),
      });

      const error = await assertRejects(
        () => resolver.resolvePage("does-not-exist"),
        VeryfrontError,
      );

      assertInstanceOf(
        error,
        VeryfrontError,
        "the rejection must carry the registry error identity",
      );
      assertEquals(
        error.slug,
        "file-not-found",
        "pageExists and the API 404 path key off this slug",
      );
      assertStringIncludes(
        error.detail ?? error.message,
        "Page not found: does-not-exist",
        "the failure must name the slug that could not be resolved",
      );
      assertEquals(
        (error.context as { router?: string } | undefined)?.router,
        "app",
        "the failure records the router that searched for the page",
      );
    });

    it("records the pages router on a missing pages-router page", async () => {
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "missing-pages",
        config: createMockConfig({ router: "pages" } as any),
        adapter: createEmptyProjectAdapter(),
      });

      const error = await assertRejects(
        () => resolver.resolvePage("does-not-exist"),
        VeryfrontError,
      );

      assertInstanceOf(
        error,
        VeryfrontError,
        "the rejection must carry the registry error identity",
      );
      assertEquals(
        error.slug,
        "file-not-found",
        "pageExists and the API 404 path key off this slug",
      );
      assertEquals(
        (error.context as { router?: string } | undefined)?.router,
        "pages",
        "the failure records the router that searched for the page",
      );
    });
  });

  describe("pageExists", () => {
    it("reports a missing page as absent", async () => {
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "exists-missing",
        config: createMockConfig({ router: "pages" } as any),
        adapter: createEmptyProjectAdapter(),
      });

      assertEquals(
        await resolver.pageExists("/no-such-page"),
        false,
        "a missing page must resolve false",
      );
    });

    it("propagates a resolution failure instead of reporting the page missing", async () => {
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "exists-cancelled",
        config: createMockConfig({ router: "pages" } as any),
        adapter: createEmptyProjectAdapter(),
      });
      const controller = new AbortController();
      const reason = new Error("cancelled");
      controller.abort(reason);

      const error = await assertRejects(
        () => resolver.pageExists("/no-such-page", { signal: controller.signal }),
        Error,
      );

      assertStrictEquals(
        error,
        reason,
        "a cancelled resolution must not be reported as a missing page",
      );
    });
  });

  describe("getAllPages - app router discovery", () => {
    it("should discover pages from app directory with page.tsx files", async () => {
      const adapter = createMockAdapter(
        {
          "/project/app": [
            { name: "page.tsx", isFile: true, isDirectory: false },
            { name: "about", isFile: false, isDirectory: true },
          ],
          "/project/app/about": [
            { name: "page.tsx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/app"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("/"), true);
      assertEquals(pages.includes("/about"), true);
    });

    it("should skip parallel routes (@-prefixed dirs)", async () => {
      const adapter = createMockAdapter(
        {
          "/project/app": [
            { name: "page.tsx", isFile: true, isDirectory: false },
            { name: "@modal", isFile: false, isDirectory: true },
          ],
          "/project/app/@modal": [
            { name: "page.tsx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/app"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("/"), true);
      assertEquals(pages.length, 1); // Only root, not @modal
    });

    it("should skip private folders (_-prefixed dirs)", async () => {
      const adapter = createMockAdapter(
        {
          "/project/app": [
            { name: "page.tsx", isFile: true, isDirectory: false },
            { name: "_components", isFile: false, isDirectory: true },
          ],
          "/project/app/_components": [
            { name: "page.tsx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/app"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.length, 1); // Only root
    });

    it("should traverse route groups (()-prefixed dirs) without adding segment", async () => {
      const adapter = createMockAdapter(
        {
          "/project/app": [
            { name: "(marketing)", isFile: false, isDirectory: true },
          ],
          "/project/app/(marketing)": [
            { name: "page.tsx", isFile: true, isDirectory: false },
            { name: "blog", isFile: false, isDirectory: true },
          ],
          "/project/app/(marketing)/blog": [
            { name: "page.tsx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/app"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("/"), true);
      assertEquals(pages.includes("/blog"), true);
    });

    it("should handle nested app router directories", async () => {
      const adapter = createMockAdapter(
        {
          "/project/app": [
            { name: "docs", isFile: false, isDirectory: true },
          ],
          "/project/app/docs": [
            { name: "guide", isFile: false, isDirectory: true },
          ],
          "/project/app/docs/guide": [
            { name: "page.mdx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/app"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("/docs/guide"), true);
    });
  });

  describe("getRouterMode", () => {
    it("returns pages when config.router is pages", async () => {
      const adapter = createMockAdapter({ "/project": [] });
      const config = createMockConfig({ router: "pages" } as any);
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const mode = await resolver.getRouterMode();
      assertEquals(mode, "pages");
    });

    it("returns app when config.router is app", async () => {
      const adapter = createMockAdapter({ "/project": [] });
      const config = createMockConfig({ router: "app" } as any);
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const mode = await resolver.getRouterMode();
      assertEquals(mode, "app");
    });
  });

  describe("getAllPages", () => {
    it("should discover pages from root project dir", async () => {
      const adapter = createMockAdapter(
        {
          "/project": [
            { name: "index.mdx", isFile: true, isDirectory: false },
            { name: "about.tsx", isFile: true, isDirectory: false },
          ],
        },
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("/"), true);
      assertEquals(pages.includes("about"), true);
    });

    it("should discover pages from pages directory", async () => {
      const adapter = createMockAdapter(
        {
          "/project/pages": [
            { name: "contact.mdx", isFile: true, isDirectory: false },
            { name: "blog.tsx", isFile: true, isDirectory: false },
          ],
          "/project": [],
        },
        ["/project/pages"],
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("contact"), true);
      assertEquals(pages.includes("blog"), true);
    });

    it("should skip config files", async () => {
      const adapter = createMockAdapter(
        {
          "/project": [
            { name: "veryfront.config.ts", isFile: true, isDirectory: false },
            { name: "about.mdx", isFile: true, isDirectory: false },
          ],
        },
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.includes("about"), true);
      assertEquals(pages.every((p: string) => !p.includes("config")), true);
    });

    it("should skip non-page file extensions", async () => {
      const adapter = createMockAdapter(
        {
          "/project": [
            { name: "styles.css", isFile: true, isDirectory: false },
            { name: "data.json", isFile: true, isDirectory: false },
            { name: "readme.txt", isFile: true, isDirectory: false },
          ],
        },
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.length, 0);
    });

    it("should return empty array when no pages exist", async () => {
      const adapter = createMockAdapter({ "/project": [] });
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.length, 0);
    });

    it("should handle all supported page extensions", async () => {
      const adapter = createMockAdapter(
        {
          "/project": [
            { name: "a.mdx", isFile: true, isDirectory: false },
            { name: "b.md", isFile: true, isDirectory: false },
            { name: "c.tsx", isFile: true, isDirectory: false },
            { name: "d.jsx", isFile: true, isDirectory: false },
            { name: "e.ts", isFile: true, isDirectory: false },
            { name: "f.js", isFile: true, isDirectory: false },
          ],
        },
      );
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        config,
        adapter,
      });
      const pages = await resolver.getAllPages();
      assertEquals(pages.length, 6);
    });
  });
});
