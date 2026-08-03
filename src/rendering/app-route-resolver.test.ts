import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAppRouteEntity } from "./app-route-resolver.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(
  files: Map<string, string>,
  dirs: Set<string> = new Set(),
): RuntimeAdapter {
  const allPaths = () => [...files.keys(), ...dirs];

  return {
    fs: {
      symlinkSemantics: "none",
      readFile: (path: string) => {
        const content = files.get(path);
        if (content === undefined) {
          return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }));
        }
        return Promise.resolve(content);
      },
      readFileBytesWithinLimit: (path: string, byteLimit: number) => {
        const content = files.get(path);
        if (content === undefined) {
          return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }));
        }
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > byteLimit) {
          return Promise.reject(new RangeError(`File exceeds ${byteLimit} bytes`));
        }
        return Promise.resolve(bytes);
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

    it("rejects traversal slugs before consulting the filesystem", async () => {
      const adapter = createMockAdapter(new Map());
      let resolveCalls = 0;
      adapter.fs.resolveFile = () => {
        resolveCalls++;
        return Promise.resolve("/outside/page.mdx");
      };

      assertEquals(
        await getAppRouteEntity("/project", "../../outside", adapter),
        null,
      );
      assertEquals(resolveCalls, 0);
    });

    it("does not read an adapter-resolved page outside the App Router root", async () => {
      const adapter = createMockAdapter(new Map());
      let reads = 0;
      adapter.fs.resolveFile = () => Promise.resolve("/outside/page.mdx");
      adapter.fs.readFileBytesWithinLimit = () => {
        reads++;
        return Promise.resolve(new TextEncoder().encode("# Secret"));
      };

      assertEquals(await getAppRouteEntity("/project", "about", adapter), null);
      assertEquals(reads, 0);
    });

    it("preserves adapter read failures instead of reporting a missing page", async () => {
      const outage = Object.freeze({ code: "ENOENT", detail: "remote source unavailable" });
      const adapter = createMockAdapter(new Map());
      adapter.fs.resolveFile = (path: string) =>
        Promise.resolve(path.endsWith("/page") ? `${path}.mdx` : null);
      adapter.fs.readFileBytesWithinLimit = () => Promise.reject(outage);

      let caught: unknown;
      try {
        await getAppRouteEntity("/project", "about", adapter);
      } catch (error) {
        caught = error;
      }
      assertEquals(caught === outage, true);
    });

    it("preserves adapter directory failures during dynamic discovery", async () => {
      const outage = Object.freeze({ code: "ENOENT", detail: "directory service unavailable" });
      const adapter = createMockAdapter(new Map());
      adapter.fs.readDir = () => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(outage),
          };
        },
      });

      let caught: unknown;
      try {
        await getAppRouteEntity("/project", "article", adapter);
      } catch (error) {
        caught = error;
      }
      assertEquals(caught === outage, true);
    });

    it("does not treat file-suffixed names as dynamic route directories", async () => {
      const files = new Map([
        ["/project/app/[id].tsx/page.tsx", "export default function Page() {}"],
      ]);
      const dirs = new Set(["/project/app", "/project/app/[id].tsx"]);

      assertEquals(
        await getAppRouteEntity("/project", "article", createMockAdapter(files, dirs)),
        null,
      );
    });

    it("uses the bounded reader and never the raw text reader", async () => {
      const adapter = createMockAdapter(
        new Map([
          ["/project/app/page.mdx", "# Page"],
        ]),
      );
      let rawReads = 0;
      adapter.fs.readFile = () => {
        rawReads++;
        return Promise.resolve("# Unbounded page");
      };

      const result = await getAppRouteEntity("/project", "", adapter);

      assertEquals(result?.entity.content, "# Page");
      assertEquals(rawReads, 0);
    });

    it("binds link-resolving App Router reads to the App root snapshot", async () => {
      const adapter = createMockAdapter(new Map());
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      let boundedReads = 0;
      const snapshotCalls: Array<[string, string, number]> = [];
      adapter.fs.readFileBytesWithinLimit = () => {
        boundedReads++;
        return Promise.resolve(new TextEncoder().encode("# Unbound"));
      };
      adapter.fs.readFileSnapshotWithinLimit = (
        path: string,
        root: string,
        byteLimit: number,
      ) => {
        snapshotCalls.push([path, root, byteLimit]);
        return Promise.resolve(new TextEncoder().encode("# Bound"));
      };

      const result = await getAppRouteEntity("/project", "", adapter);

      assertEquals(result?.entity.content, "# Bound");
      assertEquals(boundedReads, 0);
      assertEquals(snapshotCalls.length, 1);
      assertEquals(snapshotCalls[0]?.[0], "/project/app/page.mdx");
      assertEquals(snapshotCalls[0]?.[1], "/project/app");
      assertEquals(Number(snapshotCalls[0]?.[2]) > 0, true);
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
  });
});
