import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAppRouteEntity } from "./app-route-resolver.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { extractRouteParams } from "#veryfront/utils/route-path-utils.ts";

function createMockAdapter(
  files: Map<string, string>,
  dirs: Set<string> = new Set(),
): RuntimeAdapter {
  const allPaths = () => [...files.keys(), ...dirs];

  return {
    fs: {
      readFile: (path: string) => {
        const content = files.get(path);
        if (content === undefined) {
          return Promise.reject(
            Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
          );
        }
        return Promise.resolve(content);
      },
      stat: (path: string) => {
        if (files.has(path)) {
          return Promise.resolve({ isFile: true, isDirectory: false });
        }
        if (dirs.has(path)) {
          return Promise.resolve({ isFile: false, isDirectory: true });
        }
        return Promise.reject(
          Object.assign(new Error(`Not found: ${path}`), { code: "ENOENT" }),
        );
      },
      readDir: (path: string) =>
        (async function* () {
          const prefix = path.endsWith("/") ? path : `${path}/`;
          const seen = new Set<string>();

          for (const key of allPaths()) {
            if (!key.startsWith(prefix)) continue;

            const rest = key.slice(prefix.length);
            const name = rest.split("/")[0];
            if (!name || seen.has(name)) continue;

            seen.add(name);

            const full = `${prefix}${name}`;
            const isDir = dirs.has(full) || allPaths().some((k) => k.startsWith(`${full}/`));

            yield {
              name,
              isFile: files.has(full),
              isDirectory: isDir,
              isSymlink: false,
            };
          }
        })(),
      exists: (path: string) => Promise.resolve(files.has(path) || dirs.has(path)),
      writeFile: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

describe("rendering/app-route-resolver", () => {
  describe("getAppRouteEntity", () => {
    it("should resolve an exact page.mdx match", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\ntitle: Home\n---\n# Hello"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.slug, "");
      assertEquals(result?.entity.type, "page");
    });

    it("should resolve a nested page", async () => {
      const files = new Map([
        ["/project/app/about/page.mdx", "---\ntitle: About\n---\nAbout page"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "about", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.slug, "about");
    });

    it("should resolve .tsx page files", async () => {
      const files = new Map([
        ["/project/app/dashboard/page.tsx", `export default function Dashboard() {}`],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "dashboard", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.slug, "dashboard");
    });

    it("should return null for non-existent routes", async () => {
      const adapter = createMockAdapter(new Map());

      const result = await getAppRouteEntity("/project", "nonexistent", adapter);
      assertEquals(result, null);
    });

    it("should extract frontmatter from MDX files", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\ntitle: My Page\ndescription: A test\n---\n# Content"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.frontmatter?.title, "My Page");
      assertEquals(result?.entity.frontmatter?.description, "A test");
    });

    it("should handle pages without frontmatter", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "# No frontmatter here"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.content, "# No frontmatter here");
    });

    it("should prefer page.mdx over page.tsx", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\ntitle: MDX\n---\nMDX content"],
        ["/project/app/page.tsx", `export default function Page() {}`],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.path.endsWith("page.mdx"), true);
    });

    it("should resolve dynamic route segments", async () => {
      const files = new Map([
        ["/project/app/blog/[slug]/page.mdx", "---\ntitle: Blog Post\n---\nPost"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/blog",
        "/project/app/blog/[slug]",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const result = await getAppRouteEntity("/project", "blog/hello-world", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.slug, "blog/hello-world");
    });

    it("should resolve a root page inside an App Router route group", async () => {
      const files = new Map([
        ["/project/app/(marketing)/page.mdx", "# Marketing home"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(marketing)",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const result = await getAppRouteEntity("/project", "", adapter);

      assertEquals(result?.entity.path, "/project/app/(marketing)/page.mdx");
      assertEquals(result?.entity.slug, "");
    });

    it("should omit nested route groups from static URL paths", async () => {
      const files = new Map([
        ["/project/app/(marketing)/(published)/about/page.tsx", "export default null"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(marketing)",
        "/project/app/(marketing)/(published)",
        "/project/app/(marketing)/(published)/about",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const result = await getAppRouteEntity("/project", "about", adapter);

      assertEquals(
        result?.entity.path,
        "/project/app/(marketing)/(published)/about/page.tsx",
      );
      assertEquals(result?.entity.slug, "about");
    });

    it("should omit route groups while resolving dynamic URL paths", async () => {
      const files = new Map([
        ["/project/app/shop/(catalog)/[id]/page.mdx", "# Product"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/shop",
        "/project/app/shop/(catalog)",
        "/project/app/shop/(catalog)/[id]",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const result = await getAppRouteEntity("/project", "shop/laptop", adapter);

      assertEquals(
        result?.entity.path,
        "/project/app/shop/(catalog)/[id]/page.mdx",
      );
      assertEquals(result?.entity.slug, "shop/laptop");
      assertEquals(
        result ? extractRouteParams(result.entity.path, result.entity.slug) : null,
        { params: { id: "laptop" }, matched: true },
      );
    });

    it("should require a segment for required catch-alls and preserve suffixes", async () => {
      const files = new Map([
        ["/project/app/docs/[...slug]/edit/page.mdx", "# Edit docs"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/docs",
        "/project/app/docs/[...slug]",
        "/project/app/docs/[...slug]/edit",
      ]);
      const adapter = createMockAdapter(files, dirs);

      assertEquals(
        (await getAppRouteEntity("/project", "docs/api/edit", adapter))
          ?.entity.path,
        "/project/app/docs/[...slug]/edit/page.mdx",
      );
      assertEquals(
        await getAppRouteEntity("/project", "docs/edit", adapter),
        null,
      );
    });

    it("should allow an empty optional catch-all before a suffix", async () => {
      const files = new Map([
        ["/project/app/docs/[[...slug]]/edit/page.mdx", "# Edit docs"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/docs",
        "/project/app/docs/[[...slug]]",
        "/project/app/docs/[[...slug]]/edit",
      ]);
      const adapter = createMockAdapter(files, dirs);

      assertEquals(
        (await getAppRouteEntity("/project", "docs/edit", adapter))?.entity
          .path,
        "/project/app/docs/[[...slug]]/edit/page.mdx",
      );
      assertEquals(
        (await getAppRouteEntity("/project", "docs/api/edit", adapter))
          ?.entity.path,
        "/project/app/docs/[[...slug]]/edit/page.mdx",
      );
    });

    it("ranks route specificity globally across route groups", async () => {
      const files = new Map([
        ["/project/app/(a)/[...slug]/page.mdx", "# Catch all"],
        ["/project/app/(z)/foo/page.mdx", "# Static"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(a)",
        "/project/app/(a)/[...slug]",
        "/project/app/(z)",
        "/project/app/(z)/foo",
      ]);

      const result = await getAppRouteEntity(
        "/project",
        "foo",
        createMockAdapter(files, dirs),
      );

      assertEquals(result?.entity.path, "/project/app/(z)/foo/page.mdx");
    });

    it("prefers a direct dynamic route over a grouped catch-all", async () => {
      const files = new Map([
        ["/project/app/[id]/page.mdx", "# Dynamic"],
        ["/project/app/(catalog)/[...slug]/page.mdx", "# Catch all"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/[id]",
        "/project/app/(catalog)",
        "/project/app/(catalog)/[...slug]",
      ]);

      const result = await getAppRouteEntity(
        "/project",
        "laptop",
        createMockAdapter(files, dirs),
      );

      assertEquals(result?.entity.path, "/project/app/[id]/page.mdx");
    });

    it("prefers an exact route over an empty optional catch-all", async () => {
      const files = new Map([
        ["/project/app/docs/page.mdx", "# Exact"],
        ["/project/app/docs/[[...slug]]/page.mdx", "# Optional"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/docs",
        "/project/app/docs/[[...slug]]",
      ]);

      const result = await getAppRouteEntity(
        "/project",
        "docs",
        createMockAdapter(files, dirs),
      );

      assertEquals(result?.entity.path, "/project/app/docs/page.mdx");
    });

    it("ranks a static suffix after an empty optional catch-all over a dynamic route", async () => {
      const files = new Map([
        ["/project/app/foo/[[...slug]]/bar/page.mdx", "# Static suffix"],
        ["/project/app/foo/[id]/page.mdx", "# Dynamic"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/foo",
        "/project/app/foo/[[...slug]]",
        "/project/app/foo/[[...slug]]/bar",
        "/project/app/foo/[id]",
      ]);

      const result = await getAppRouteEntity(
        "/project",
        "foo/bar",
        createMockAdapter(files, dirs),
      );

      assertEquals(
        result?.entity.path,
        "/project/app/foo/[[...slug]]/bar/page.mdx",
      );
    });

    it("rejects equal-shape dynamic route ambiguity", async () => {
      const files = new Map([
        ["/project/app/[id]/page.mdx", "# By id"],
        ["/project/app/[slug]/page.mdx", "# By slug"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/[id]",
        "/project/app/[slug]",
      ]);

      assertEquals(
        await getAppRouteEntity(
          "/project",
          "value",
          createMockAdapter(files, dirs),
        ),
        null,
      );
    });

    it("rejects equal-shape route-group ambiguity", async () => {
      const files = new Map([
        ["/project/app/(alpha)/about/page.mdx", "# Alpha"],
        ["/project/app/(beta)/about/page.mdx", "# Beta"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(alpha)",
        "/project/app/(alpha)/about",
        "/project/app/(beta)",
        "/project/app/(beta)/about",
      ]);

      assertEquals(
        await getAppRouteEntity(
          "/project",
          "about",
          createMockAdapter(files, dirs),
        ),
        null,
      );
    });

    it("should not expose a route-group directory as a URL segment", async () => {
      const files = new Map([
        ["/project/app/(marketing)/about/page.mdx", "# About"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(marketing)",
        "/project/app/(marketing)/about",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const result = await getAppRouteEntity(
        "/project",
        "(marketing)/about",
        adapter,
      );

      assertEquals(result, null);
    });

    it("should reject path-control segments before reading page files", async () => {
      const files = new Map([
        ["/project/app/../secret/page.mdx", "# Secret"],
        ["/project/app/./internal/page.mdx", "# Internal"],
      ]);
      const adapter = createMockAdapter(files);

      assertEquals(
        await getAppRouteEntity("/project", "../secret", adapter),
        null,
      );
      assertEquals(
        await getAppRouteEntity("/project", "./internal", adapter),
        null,
      );
    });

    it("rejects encoded traversal, controls, separators, and malformed encoding before I/O", async () => {
      const adapter = createMockAdapter(new Map());
      let reads = 0;
      adapter.fs.readFile = () => {
        reads++;
        return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
      };
      adapter.fs.readDir = () => {
        reads++;
        return (async function* () {})();
      };

      for (
        const slug of [
          "line\rbreak",
          "line\nbreak",
          "tab\tbreak",
          "delete\u007f",
          "control\u0085",
          "%2e%2e/secret",
          "safe%2fsecret",
          "%0dheader",
          "%zz",
        ]
      ) {
        assertEquals(await getAppRouteEntity("/project", slug, adapter), null);
      }

      assertEquals(reads, 0);
    });

    it("rejects unsafe app directory names before filesystem access", async () => {
      const adapter = createMockAdapter(new Map());
      let reads = 0;
      adapter.fs.readFile = () => {
        reads++;
        return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
      };
      adapter.fs.readDir = () => {
        reads++;
        return (async function* () {})();
      };

      for (const appDir of ["../secret", "src/../secret", "/absolute", "app\n"]) {
        assertEquals(
          await getAppRouteEntity("/project", "", adapter, appDir),
          null,
        );
      }

      assertEquals(reads, 0);
    });

    it("does not traverse a directory whose canonical path escapes the app root", async () => {
      const files = new Map([
        ["/project/app/escape/page.mdx", "# Escaped"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/escape",
      ]);
      const adapter = createMockAdapter(files, dirs);
      const visitedDirectories: string[] = [];
      const readDir = adapter.fs.readDir;
      adapter.fs.readDir = (path) => {
        visitedDirectories.push(path);
        return readDir(path);
      };
      adapter.fs.realPath = (path) =>
        Promise.resolve(path === "/project/app/escape" ? "/outside/escape" : path);

      assertEquals(
        await getAppRouteEntity("/project", "escape", adapter),
        null,
      );
      assertEquals(visitedDirectories.includes("/project/app/escape"), false);
    });

    it("does not expose interception-route directories", async () => {
      const files = new Map([
        ["/project/app/(.)photo/page.mdx", "# Intercepted"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/(.)photo",
      ]);

      assertEquals(
        await getAppRouteEntity(
          "/project",
          "photo",
          createMockAdapter(files, dirs),
        ),
        null,
      );
    });

    it("does not expose private or parallel-route directories", async () => {
      const files = new Map([
        ["/project/app/_private/page.mdx", "# Private"],
        ["/project/app/@modal/page.mdx", "# Modal"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/_private",
        "/project/app/@modal",
      ]);
      const adapter = createMockAdapter(files, dirs);

      assertEquals(
        await getAppRouteEntity("/project", "_private", adapter),
        null,
      );
      assertEquals(
        await getAppRouteEntity("/project", "@modal", adapter),
        null,
      );
    });

    it("should convert boolean layout frontmatter to string", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\nlayout: true\n---\nContent"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.frontmatter?.layout, "default");
    });

    it("should convert false layout to 'false' string", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\nlayout: false\n---\nContent"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result?.entity.frontmatter?.layout, "false");
    });

    it("should use custom appDirName", async () => {
      const files = new Map([
        ["/project/pages/page.mdx", "---\ntitle: Custom\n---\nCustom dir"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter, "pages");
      assertEquals(result !== null, true);
    });

    it("should handle malformed frontmatter gracefully", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\ninvalid: yaml: : :\n---\n# Content"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
    });

    it("should resolve file-extension pages (e.g., about.mdx)", async () => {
      const files = new Map([
        ["/project/app/about.mdx", "---\ntitle: About\n---\nAbout page"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "about", adapter);
      assertEquals(result !== null, true);
    });

    it("uses adapter-independent extension priority and never invokes resolveFile", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "# MDX"],
        ["/project/app/page.tsx", "export default null"],
      ]);
      const adapter = createMockAdapter(files);
      let resolveCalls = 0;
      adapter.fs.resolveFile = () => {
        resolveCalls++;
        return Promise.resolve("/project/app/page.tsx");
      };

      const result = await getAppRouteEntity("/project", "", adapter);

      assertEquals(result?.entity.path, "/project/app/page.mdx");
      assertEquals(resolveCalls, 0);
    });

    it("does not accept an adapter's implicit Pages Router fallback", async () => {
      const files = new Map([
        ["/project/pages/about.mdx", "# Legacy page"],
      ]);
      const adapter = createMockAdapter(files);
      let resolveCalls = 0;
      adapter.fs.resolveFile = () => {
        resolveCalls++;
        return Promise.resolve("/project/pages/about.mdx");
      };

      assertEquals(
        await getAppRouteEntity("/project", "about", adapter),
        null,
      );
      assertEquals(resolveCalls, 0);
    });

    it("propagates operational readFile errors", async () => {
      const adapter = createMockAdapter(new Map());
      adapter.fs.readFile = () =>
        Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));

      await assertRejects(
        () => getAppRouteEntity("/project", "", adapter),
        Error,
        "permission denied",
      );
    });

    it("propagates operational readDir errors", async () => {
      const adapter = createMockAdapter(new Map());
      adapter.fs.readDir = () =>
        (async function* () {
          yield* [];
          throw new Error("backend unavailable");
        })();

      await assertRejects(
        () => getAppRouteEntity("/project", "missing", adapter),
        Error,
        "backend unavailable",
      );
    });

    it("keeps concurrent route resolution state isolated", async () => {
      const files = new Map([
        ["/project/app/blog/[id]/page.mdx", "# Blog"],
        ["/project/app/docs/[...slug]/page.mdx", "# Docs"],
      ]);
      const dirs = new Set([
        "/project/app",
        "/project/app/blog",
        "/project/app/blog/[id]",
        "/project/app/docs",
        "/project/app/docs/[...slug]",
      ]);
      const adapter = createMockAdapter(files, dirs);

      const [blog, docs] = await Promise.all([
        getAppRouteEntity("/project", "blog/42", adapter),
        getAppRouteEntity("/project", "docs/api/reference", adapter),
      ]);

      assertEquals(blog?.entity.path, "/project/app/blog/[id]/page.mdx");
      assertEquals(docs?.entity.path, "/project/app/docs/[...slug]/page.mdx");
    });

    it("does not expand optional catch-alls once per URL segment", async () => {
      const catchAllDirectories = Array.from(
        { length: 5 },
        (_, index) => `/project/app/[[...part${index}]]`,
      );
      const files = new Map(
        catchAllDirectories.map((dir) => [`${dir}/page.mdx`, "# Optional"]),
      );
      const dirs = new Set(["/project/app", ...catchAllDirectories]);
      const adapter = createMockAdapter(files, dirs);
      const readDir = adapter.fs.readDir;
      let directoryReads = 0;
      adapter.fs.readDir = (path) => {
        directoryReads++;
        return readDir(path);
      };
      const slug = `${"a/".repeat(2047)}a`;

      assertEquals(slug.length, 4095);
      assertEquals(await getAppRouteEntity("/project", slug, adapter), null);
      assertEquals(directoryReads <= catchAllDirectories.length + 1, true);
    });
  });
});
