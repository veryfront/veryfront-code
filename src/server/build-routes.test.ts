import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectAppRoutes, collectPagesRoutes } from "./build-routes.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
} from "#veryfront/utils/logger/logger.ts";

// ---------- In-memory filesystem mock ----------

interface FsNode {
  type: "file" | "dir";
  content?: string;
}

function notFound(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

function createMockAdapter(files: Record<string, string>): RuntimeAdapter {
  // Build a node map: directories are inferred from file paths
  const nodes = new Map<string, FsNode>();

  for (const [filePath, content] of Object.entries(files)) {
    nodes.set(filePath, { type: "file", content });

    // Register all ancestor directories
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!nodes.has(dirPath)) {
        nodes.set(dirPath, { type: "dir" });
      }
    }
  }

  const fs = {
    stat(path: string) {
      const node = nodes.get(path);
      if (!node) return Promise.reject(notFound(path));
      return Promise.resolve({
        size: node.content?.length ?? 0,
        isFile: node.type === "file",
        isDirectory: node.type === "dir",
        isSymlink: false,
        mtime: new Date(),
      });
    },

    readFile(path: string) {
      const node = nodes.get(path);
      if (!node || node.type !== "file") return Promise.reject(notFound(path));
      return Promise.resolve(node.content ?? "");
    },

    exists(path: string) {
      return Promise.resolve(nodes.has(path));
    },

    readDir(path: string) {
      // Yield direct children of `path`
      const prefix = path.endsWith("/") ? path : path + "/";
      const children = new Map<string, FsNode>();

      for (const [p, node] of nodes) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest || rest.includes("/")) {
          // Not a direct child file, but maybe a direct child dir
          const firstSeg = rest.split("/")[0];
          if (firstSeg && !children.has(firstSeg)) {
            children.set(firstSeg, { type: "dir" });
          }
          continue;
        }
        children.set(rest, node);
      }

      return {
        async *[Symbol.asyncIterator]() {
          for (const [name, node] of children) {
            yield {
              name,
              isFile: node.type === "file",
              isDirectory: node.type === "dir",
              isSymlink: false,
            };
          }
        },
      };
    },

    // Stubs for unused methods
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    makeTempDir: () => Promise.resolve("/tmp/mock"),
    watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
  };

  return {
    id: "deno",
    name: "mock",
    capabilities: {} as RuntimeAdapter["capabilities"],
    fs,
    env: {} as RuntimeAdapter["env"],
    server: {} as RuntimeAdapter["server"],
    serve: () =>
      Promise.resolve(
        {} as ReturnType<RuntimeAdapter["serve"]> extends Promise<infer T> ? T : never,
      ),
  } as unknown as RuntimeAdapter;
}

// ---------- Tests ----------

describe("server/build-routes", () => {
  describe("collectPagesRoutes", () => {
    it("returns empty when no pages directory", async () => {
      const adapter = createMockAdapter({});
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes, []);
    });

    it("propagates pages directory access failures", async () => {
      const adapter = createMockAdapter({});
      adapter.fs.stat = () => Promise.reject(new Error("pages permission denied"));

      await assertRejects(
        () => collectPagesRoutes(adapter, "/project"),
        Error,
        "pages permission denied",
      );
    });

    it("discovers .mdx files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/hello.mdx": "# Hello",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "hello");
      assertEquals(routes[0]!.path, "/hello");
    });

    it("discovers .md files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/readme.md": "# Readme",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "readme");
    });

    it("discovers .tsx files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/about.tsx": "export default () => <div/>",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "about");
    });

    it("discovers .jsx files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/contact.jsx": "export default () => <div/>",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "contact");
    });

    it("discovers .js files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/legal.js": "export default () => null",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "legal");
      assertEquals(routes[0]!.path, "/legal");
    });

    it("discovers .ts files", async () => {
      const adapter = createMockAdapter({
        "/project/pages/api.ts": "export default {}",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "api");
    });

    it("excludes api directory descendants while preserving root /api pages", async () => {
      const adapter = createMockAdapter({
        "/project/pages/api.tsx": "export default () => <div />",
        "/project/pages/api/user.ts": "export default function handler() {}",
        "/project/pages/api/admin/index.ts": "export default function handler() {}",
        "/project/pages/about.tsx": "export default () => <div />",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      const paths = routes.map((r) => r.path).sort();
      assertEquals(paths, ["/about", "/api"]);
    });

    it("excludes Pages Router layout files from static page routes", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "export default () => <div />",
        "/project/pages/layout.tsx": "export default ({ children }) => children",
        "/project/pages/chat/index.tsx": "export default () => <div />",
        "/project/pages/chat/layout.tsx": "export default ({ children }) => children",
        "/project/pages/docs/index.mdx": "# Docs",
        "/project/pages/docs/layout.mdx": "# Docs layout",
      });

      const routes = await collectPagesRoutes(adapter, "/project");

      assertEquals(routes.map((route) => route.path).sort(), ["/", "/chat", "/docs"]);
    });

    it("excludes dynamic Pages Router routes from static generation", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "export default () => <div />",
        "/project/pages/jobs/[id].tsx": "export default () => <div />",
        "/project/pages/docs/[...slug].tsx": "export default () => <div />",
        "/project/pages/blog/index.tsx": "export default () => <div />",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.map((route) => route.path).sort(), ["/", "/blog"]);
    });

    it("converts file paths to slugs by stripping extensions", async () => {
      const adapter = createMockAdapter({
        "/project/pages/docs/guide.mdx": "# Guide",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "docs/guide");
      assertEquals(routes[0]!.path, "/docs/guide");
    });

    it("converts /index to root slug 'index' and path '/'", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "export default () => <div/>",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "index");
      assertEquals(routes[0]!.path, "/");
    });

    it("converts nested/index to nested slug without /index", async () => {
      const adapter = createMockAdapter({
        "/project/pages/blog/index.mdx": "# Blog",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.slug, "blog");
      assertEquals(routes[0]!.path, "/blog");
    });

    it("discovers multiple files across directories", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "home",
        "/project/pages/about.mdx": "about",
        "/project/pages/blog/post.md": "post",
      });
      const routes = await collectPagesRoutes(adapter, "/project");
      assertEquals(routes.length, 3);
      const slugs = routes.map((r) => r.slug).sort();
      assertEquals(slugs, ["about", "blog/post", "index"]);
    });

    it("applies include filter", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "home",
        "/project/pages/about.mdx": "about",
        "/project/pages/blog/post.md": "post",
      });
      const routes = await collectPagesRoutes(adapter, "/project", ["/blog"]);
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/blog/post");
    });

    it("applies exclude filter", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "home",
        "/project/pages/about.mdx": "about",
        "/project/pages/blog/post.md": "post",
      });
      const routes = await collectPagesRoutes(adapter, "/project", undefined, ["/blog"]);
      const paths = routes.map((r) => r.path).sort();
      assertEquals(paths, ["/", "/about"]);
    });

    it("include filter with no matches returns empty", async () => {
      const adapter = createMockAdapter({
        "/project/pages/index.tsx": "home",
      });
      const routes = await collectPagesRoutes(adapter, "/project", ["/nonexistent"]);
      assertEquals(routes, []);
    });
  });

  describe("collectAppRoutes", () => {
    it("returns empty when no app directory", async () => {
      const adapter = createMockAdapter({});
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes, []);
    });

    it("propagates app route source read failures", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
      });
      adapter.fs.readFile = () => Promise.reject(new Error("route read denied"));

      await assertRejects(
        () => collectAppRoutes(adapter, "/project"),
        Error,
        "route read denied",
      );
    });

    it("does not treat a disappearing route source as a missing app directory", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
      });
      adapter.fs.readFile = (path) => Promise.reject(notFound(path));

      await assertRejects(
        () => collectAppRoutes(adapter, "/project"),
        Error,
        "ENOENT: /project/app/page.tsx",
      );
    });

    it("propagates app directory traversal failures", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
      });
      adapter.fs.readDir = () => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(new Error("app traversal denied")),
          };
        },
      });

      await assertRejects(
        () => collectAppRoutes(adapter, "/project"),
        Error,
        "app traversal denied",
      );
    });

    it("discovers page.tsx at app root", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
      assertEquals(routes[0]!.pageFile, "/project/app/page.tsx");
      assertEquals(routes[0]!.segments, []);
    });

    it("discovers page.mdx", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.mdx": "# Home",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
    });

    it("discovers page.md", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.md": "# Home",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
    });

    it("discovers page.jsx", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.jsx": "export default () => <div/>",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
    });

    it("discovers page.ts", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.ts": "export default {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
    });

    it("discovers page.js", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.js": "export default {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
    });

    it("discovers nested routes", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/about/page.tsx": "export default function About() {}",
        "/project/app/blog/posts/page.tsx": "export default function Posts() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 3);
      const paths = routes.map((r) => r.path).sort();
      assertEquals(paths, ["/", "/about", "/blog/posts"]);
    });

    it("records correct segments for nested routes", async () => {
      const adapter = createMockAdapter({
        "/project/app/blog/posts/page.tsx": "export default function Posts() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.segments, ["blog", "posts"]);
    });

    it("skips dynamic segments like [id]", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/blog/[id]/page.tsx": "export default function Post() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
    });

    it("skips catch-all segments like [...slug]", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/docs/[...slug]/page.tsx": "export default function Docs() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
    });

    it("skips files with export const dynamic = 'force-dynamic'", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/dashboard/page.tsx":
          "export const dynamic = 'force-dynamic';\nexport default function Dashboard() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
    });

    it("does not skip files without force-dynamic", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx":
          "export const dynamic = 'auto';\nexport default function Home() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
    });

    it("applies include filter", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/about/page.tsx": "export default function About() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project", ["/about"]);
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/about");
    });

    it("applies exclude filter", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.tsx": "export default function Home() {}",
        "/project/app/about/page.tsx": "export default function About() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project", undefined, ["/about"]);
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.path, "/");
    });

    it("prefers first matching page candidate (page.mdx over page.tsx)", async () => {
      const adapter = createMockAdapter({
        "/project/app/page.mdx": "# Home MDX",
        "/project/app/page.tsx": "export default function Home() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pageFile, "/project/app/page.mdx");
    });

    it("records segmentDirs correctly", async () => {
      const adapter = createMockAdapter({
        "/project/app/blog/page.tsx": "export default function Blog() {}",
      });
      const routes = await collectAppRoutes(adapter, "/project");
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.segmentDirs, ["/project/app", "/project/app/blog"]);
    });
  });
});
