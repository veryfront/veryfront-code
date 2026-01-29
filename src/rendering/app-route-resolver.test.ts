import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAppRouteEntity } from "./app-route-resolver.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

/** Create a mock adapter with an in-memory file system */
function createMockAdapter(
  files: Map<string, string>,
  dirs: Set<string> = new Set(),
): RuntimeAdapter {
  return {
    fs: {
      readFile: (path: string) => {
        const content = files.get(path);
        if (content === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
        return Promise.resolve(content);
      },
      stat: (path: string) => {
        if (files.has(path)) {
          return Promise.resolve({ isFile: true, isDirectory: false });
        }
        if (dirs.has(path)) {
          return Promise.resolve({ isFile: false, isDirectory: true });
        }
        return Promise.reject(Object.assign(new Error(`Not found: ${path}`), { code: "ENOENT" }));
      },
      readDir: (path: string) => {
        return (async function* () {
          const prefix = path.endsWith("/") ? path : `${path}/`;
          const seen = new Set<string>();
          for (const key of [...files.keys(), ...dirs]) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const name = rest.split("/")[0];
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const isDir = dirs.has(`${prefix}${name}`) ||
              [...files.keys(), ...dirs].some((k) => k.startsWith(`${prefix}${name}/`));
            yield {
              name,
              isFile: files.has(`${prefix}${name}`),
              isDirectory: isDir,
              isSymlink: false,
            };
          }
        })();
      },
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
      assertEquals(result!.entity.slug, "");
      assertEquals(result!.entity.type, "page");
    });

    it("should resolve a nested page", async () => {
      const files = new Map([
        ["/project/app/about/page.mdx", "---\ntitle: About\n---\nAbout page"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "about", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.slug, "about");
    });

    it("should resolve .tsx page files", async () => {
      const files = new Map([
        ["/project/app/dashboard/page.tsx", `export default function Dashboard() {}`],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "dashboard", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.slug, "dashboard");
    });

    it("should return null for non-existent routes", async () => {
      const files = new Map<string, string>();
      const adapter = createMockAdapter(files);

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
      assertEquals(result!.entity.frontmatter?.title, "My Page");
      assertEquals(result!.entity.frontmatter?.description, "A test");
    });

    it("should handle pages without frontmatter", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "# No frontmatter here"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.content, "# No frontmatter here");
    });

    it("should prefer page.mdx over page.tsx", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\ntitle: MDX\n---\nMDX content"],
        ["/project/app/page.tsx", `export default function Page() {}`],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.path.endsWith("page.mdx"), true);
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
      assertEquals(result!.entity.slug, "blog/hello-world");
    });

    it("should convert boolean layout frontmatter to string", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\nlayout: true\n---\nContent"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.frontmatter?.layout, "default");
    });

    it("should convert false layout to 'false' string", async () => {
      const files = new Map([
        ["/project/app/page.mdx", "---\nlayout: false\n---\nContent"],
      ]);
      const adapter = createMockAdapter(files);

      const result = await getAppRouteEntity("/project", "", adapter);
      assertEquals(result !== null, true);
      assertEquals(result!.entity.frontmatter?.layout, "false");
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
      // Should still resolve, using raw content as fallback
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
