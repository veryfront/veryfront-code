import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageResolver } from "./page-resolver.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

function createMockAdapter(
  dirEntries: Record<string, DirEntry[]> = {},
  existingDirs: string[] = [],
): RuntimeAdapter {
  return {
    fs: {
      readFile: async () => "",
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

    it("should accept optional projectId", () => {
      const adapter = createMockAdapter();
      const config = createMockConfig();
      const resolver = new PageResolver({
        projectDir: "/project",
        projectId: "my-project",
        config,
        adapter,
      });
      assertEquals(resolver instanceof PageResolver, true);
    });
  });

  describe("resolvePage", () => {
    it("keeps auto router detection aligned with the structural app router", async () => {
      const adapter = {
        fs: {
          readFile: async (path: string) => {
            if (path === "/project/app/page.tsx") {
              return "export default function Page() { return null; }";
            }
            throw new Error("File not found");
          },
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
            throw new Error("File not found");
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
      const adapter = {
        fs: {
          readFile: async (path: string) => {
            if (path === "/project/pages/index.tsx") {
              return "export default function Page() { return null; }";
            }
            throw new Error("File not found");
          },
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
            if (path === "/project/pages") {
              return {
                isFile: false,
                isDirectory: true,
                isSymlink: false,
              };
            }
            throw new Error("File not found");
          },
          exists: async (path: string) => path === "/project/pages",
          readDir: async function* (path: string) {
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
        projectId: "project-switch",
        config,
        adapter,
      });

      const page = await resolver.resolvePage("/");
      const routerMode = await resolver.getRouterMode();

      assertEquals(page.entity.path, "/project/pages/index.tsx");
      assertEquals(routerMode, "pages");
    });

    it("does not poison auto router detection from a pages fallback", async () => {
      const adapter = {
        fs: {
          readFile: async (path: string) => {
            if (path === "/project/pages/index.tsx") {
              return "export default function Page() { return null; }";
            }
            throw new Error("File not found");
          },
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
            throw new Error("File not found");
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
