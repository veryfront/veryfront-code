/**
 * Route Discovery and Collection Tests
 *
 * Tests comprehensive route discovery functionality:
 * - Dynamic segment detection: [id], [slug]
 * - Nested route collection
 * - Include/exclude filtering
 * - Catch-all routes: [...slug]
 * - Optional catch-all: [[...slug]]
 * - force-dynamic detection
 * - Missing directories handling
 * - walkDirectory recursion
 * - Special characters in filenames
 * - Index routes
 * - Layout.tsx vs page.tsx detection
 * - Route priority and ordering
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";
import "../../_helpers/log-guard.ts";
import { collectAppRoutes, collectPagesRoutes } from "../../../src/server/build-routes.ts";
import type { AppRouteInfo, RouteInfo } from "../../../src/server/build-types.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

describe("Route Discovery Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("Route Discovery - Pages Router", () => {
    it("should collect basic index route", async () => {
      await withTestContext("routes-pages-index", async (context) => {
        await writeTextFile(
          join(context.projectDir, "pages", "index.tsx"),
          "export default function Home() { return <div>Home</div> }",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/");
        assertEquals(routes[0]!.slug, "index");
        assert(routes[0]!.file.endsWith("pages/index.tsx"));
      });
    });

    it("should collect nested routes", async () => {
      await withTestContext("routes-pages-nested", async (context) => {
        await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "pages", "blog", "index.tsx"),
          "export default function Blog() { return <div>Blog</div> }",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() { return <div>Post</div> }",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 2);
        const paths = routes.map((r: RouteInfo) => r.path).sort();
        assertEquals(paths, ["/blog", "/blog/post"]);
      });
    });

    it("should handle deeply nested routes", async () => {
      await withTestContext("routes-pages-deep-nested", async (context) => {
        const deepPath = join(context.projectDir, "pages", "a", "b", "c", "d");
        await mkdir(deepPath, { recursive: true });
        await writeTextFile(
          join(deepPath, "page.tsx"),
          "export default function Deep() { return <div>Deep</div> }",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/a/b/c/d/page");
      });
    });

    it("should handle multiple file extensions", async () => {
      await withTestContext("routes-pages-extensions", async (context) => {
        await writeTextFile(
          join(context.projectDir, "pages", "tsx-page.tsx"),
          "export default function TsxPage() {}",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "jsx-page.jsx"),
          "export default function JsxPage() {}",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "ts-page.ts"),
          "export default function TsPage() {}",
        );
        await writeTextFile(join(context.projectDir, "pages", "mdx-page.mdx"), "# MDX Page");

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 4);
        const slugs = routes.map((r: RouteInfo) => r.slug).sort();
        assertEquals(slugs, ["jsx-page", "mdx-page", "ts-page", "tsx-page"]);
      });
    });

    it("should ignore non-page files", async () => {
      await withTestContext("routes-pages-ignore-non-pages", async (context) => {
        await writeTextFile(
          join(context.projectDir, "pages", "page.tsx"),
          "export default function Page() {}",
        );
        await writeTextFile(join(context.projectDir, "pages", "styles.css"), "body { margin: 0; }");
        await writeTextFile(join(context.projectDir, "pages", "data.json"), '{"key": "value"}');
        // NOTE: .md is a valid page extension, use .txt for non-page file
        await writeTextFile(join(context.projectDir, "pages", "README.txt"), "# README");

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.slug, "page");
      });
    });

    it("should handle missing pages directory gracefully", async () => {
      await withTestContext("routes-pages-missing-dir", async (context) => {
        await remove(join(context.projectDir, "pages"), { recursive: true });

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should filter routes with include pattern", async () => {
      await withTestContext("routes-pages-include", async (context) => {
        await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await mkdir(join(context.projectDir, "pages", "docs"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() {}",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "docs", "guide.tsx"),
          "export default function Guide() {}",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir, ["/blog"]);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog/post");
      });
    });

    it("should filter routes with exclude pattern", async () => {
      await withTestContext("routes-pages-exclude", async (context) => {
        await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await mkdir(join(context.projectDir, "pages", "admin"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() {}",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "admin", "dashboard.tsx"),
          "export default function Dashboard() {}",
        );

        const routes = await collectPagesRoutes(
          await getAdapter(),
          context.projectDir,
          undefined,
          ["/admin"],
        );

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog/post");
      });
    });

    it("should handle special characters in filenames", async () => {
      await withTestContext("routes-pages-special-chars", async (context) => {
        await writeTextFile(
          join(context.projectDir, "pages", "hello-world.tsx"),
          "export default function HelloWorld() {}",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "my_page.tsx"),
          "export default function MyPage() {}",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 2);
        const slugs = routes.map((r: RouteInfo) => r.slug).sort();
        assertEquals(slugs, ["hello-world", "my_page"]);
      });
    });

    it("should handle index routes in subdirectories", async () => {
      await withTestContext("routes-pages-subdirectory-index", async (context) => {
        await mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "pages", "products", "index.tsx"),
          "export default function Products() {}",
        );

        const routes = await collectPagesRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/products");
        assertEquals(routes[0]!.slug, "products");
      });
    });
  });

  describe("Route Discovery - App Router", () => {
    it("should collect root page route", async () => {
      await withTestContext("routes-app-root", async (context) => {
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "export default function Home() { return <div>Home</div> }",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/");
        assert(routes[0]!.pageFile.endsWith("app/page.tsx"));
        assertEquals(routes[0]!.segments, []);
      });
    });

    it("should collect nested app routes", async () => {
      await withTestContext("routes-app-nested", async (context) => {
        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.tsx"),
          "export default function Blog() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog");
        assertEquals(routes[0]!.segments, ["blog"]);
      });
    });

    it("should skip dynamic segment routes - [id]", async () => {
      await withTestContext("routes-app-dynamic-segment", async (context) => {
        await mkdir(join(context.projectDir, "app", "posts"), { recursive: true });
        await mkdir(join(context.projectDir, "app", "posts", "[id]"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "posts", "page.tsx"),
          "export default function Posts() {}",
        );
        await writeTextFile(
          join(context.projectDir, "app", "posts", "[id]", "page.tsx"),
          "export default function Post() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/posts");
      });
    });

    it("should skip catch-all routes - [...slug]", async () => {
      await withTestContext("routes-app-catch-all", async (context) => {
        await mkdir(join(context.projectDir, "app", "docs"), { recursive: true });
        await mkdir(join(context.projectDir, "app", "docs", "[...slug]"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "docs", "[...slug]", "page.tsx"),
          "export default function Docs() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should skip optional catch-all routes - [[...slug]]", async () => {
      await withTestContext("routes-app-optional-catch-all", async (context) => {
        await mkdir(join(context.projectDir, "app", "shop"), { recursive: true });
        await mkdir(join(context.projectDir, "app", "shop", "[[...slug]]"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "shop", "[[...slug]]", "page.tsx"),
          "export default function Shop() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should detect and skip force-dynamic routes", async () => {
      await withTestContext("routes-app-force-dynamic", async (context) => {
        await mkdir(join(context.projectDir, "app", "api-data"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "api-data", "page.tsx"),
          `export const dynamic = 'force-dynamic'
export default function ApiData() {}`,
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should include static routes without force-dynamic", async () => {
      await withTestContext("routes-app-static", async (context) => {
        await mkdir(join(context.projectDir, "app", "about"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "about", "page.tsx"),
          `export const dynamic = 'auto'
export default function About() {}`,
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/about");
      });
    });

    it("should handle missing app directory gracefully", async () => {
      await withTestContext("routes-app-missing-dir", async (context) => {
        await remove(join(context.projectDir, "app"), { recursive: true });

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should prefer page.tsx over other page extensions", async () => {
      await withTestContext("routes-app-page-preference", async (context) => {
        await mkdir(join(context.projectDir, "app", "test"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "test", "page.tsx"),
          "export default function Test() {}",
        );
        await writeTextFile(
          join(context.projectDir, "app", "test", "page.jsx"),
          "export default function Test() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.tsx"));
      });
    });

    it("should handle page.jsx when page.tsx not present", async () => {
      await withTestContext("routes-app-page-jsx", async (context) => {
        await mkdir(join(context.projectDir, "app", "jsx-only"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "jsx-only", "page.jsx"),
          "export default function JsxOnly() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.jsx"));
      });
    });

    it("should handle page.ts when other extensions not present", async () => {
      await withTestContext("routes-app-page-ts", async (context) => {
        await mkdir(join(context.projectDir, "app", "ts-only"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "ts-only", "page.ts"),
          "export default function TsOnly() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.ts"));
      });
    });

    it("should handle page.js when other extensions not present", async () => {
      await withTestContext("routes-app-page-js", async (context) => {
        await mkdir(join(context.projectDir, "app", "js-only"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "js-only", "page.js"),
          "export default function JsOnly() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.js"));
      });
    });

    it("should ignore layout.tsx files", async () => {
      await withTestContext("routes-app-ignore-layout", async (context) => {
        await mkdir(join(context.projectDir, "app", "with-layout"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "with-layout", "layout.tsx"),
          "export default function Layout() {}",
        );
        await writeTextFile(
          join(context.projectDir, "app", "with-layout", "page.tsx"),
          "export default function Page() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.tsx"));
      });
    });

    it("should filter app routes with include pattern", async () => {
      await withTestContext("routes-app-include", async (context) => {
        await mkdir(join(context.projectDir, "app", "public-area"), { recursive: true });
        await mkdir(join(context.projectDir, "app", "private-area"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "public-area", "page.tsx"),
          "export default function Public() {}",
        );
        await writeTextFile(
          join(context.projectDir, "app", "private-area", "page.tsx"),
          "export default function Private() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir, [
          "/public-area",
        ]);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/public-area");
      });
    });

    it("should filter app routes with exclude pattern", async () => {
      await withTestContext("routes-app-exclude", async (context) => {
        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await mkdir(join(context.projectDir, "app", "admin"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.tsx"),
          "export default function Blog() {}",
        );
        await writeTextFile(
          join(context.projectDir, "app", "admin", "page.tsx"),
          "export default function Admin() {}",
        );

        const routes = await collectAppRoutes(
          await getAdapter(),
          context.projectDir,
          undefined,
          ["/admin"],
        );

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog");
      });
    });

    it("should handle deeply nested app routes", async () => {
      await withTestContext("routes-app-deep-nested", async (context) => {
        const deepPath = join(context.projectDir, "app", "a", "b", "c", "d");
        await mkdir(deepPath, { recursive: true });
        await writeTextFile(join(deepPath, "page.tsx"), "export default function Deep() {}");

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/a/b/c/d");
        assertEquals(routes[0]!.segments, ["a", "b", "c", "d"]);
      });
    });

    it("should handle multiple routes at different levels", async () => {
      await withTestContext("routes-app-multiple-levels", async (context) => {
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "export default function Home() {}",
        );
        await mkdir(join(context.projectDir, "app", "about"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "about", "page.tsx"),
          "export default function About() {}",
        );
        await mkdir(join(context.projectDir, "app", "about", "team"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "about", "team", "page.tsx"),
          "export default function Team() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 3);
        const paths = routes.map((r: AppRouteInfo) => r.path).sort();
        assertEquals(paths, ["/", "/about", "/about/team"]);
      });
    });

    it("should track segment directories correctly", async () => {
      await withTestContext("routes-app-segment-dirs", async (context) => {
        await mkdir(join(context.projectDir, "app", "blog", "posts"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "blog", "posts", "page.tsx"),
          "export default function Posts() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 1);
        assertExists(routes[0]!.segmentDirs);
        assertEquals(routes[0]!.segmentDirs!.length, 3); // app, blog, posts
      });
    });

    it("should handle force-dynamic with different quote styles", async () => {
      await withTestContext("routes-app-force-dynamic-quotes", async (context) => {
        await mkdir(join(context.projectDir, "app", "single"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "single", "page.tsx"),
          `export const dynamic = 'force-dynamic'`,
        );

        await mkdir(join(context.projectDir, "app", "double"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "double", "page.tsx"),
          `export const dynamic = "force-dynamic"`,
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should handle mixed dynamic and static nested routes", async () => {
      await withTestContext("routes-app-mixed-routes", async (context) => {
        await mkdir(join(context.projectDir, "app", "products"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "products", "page.tsx"),
          "export default function Products() {}",
        );
        await mkdir(join(context.projectDir, "app", "products", "featured"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "products", "featured", "page.tsx"),
          "export default function Featured() {}",
        );
        await mkdir(join(context.projectDir, "app", "products", "[id]"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "products", "[id]", "page.tsx"),
          "export default function Product() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 2);
        const paths = routes.map((r: AppRouteInfo) => r.path).sort();
        assertEquals(paths, ["/products", "/products/featured"]);
      });
    });

    it("should handle empty app directory", async () => {
      await withTestContext("routes-app-empty", async (context) => {
        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });

    it("should skip directories without page files", async () => {
      await withTestContext("routes-app-no-page-files", async (context) => {
        await mkdir(join(context.projectDir, "app", "components"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "components", "Button.tsx"),
          "export default function Button() {}",
        );
        await mkdir(join(context.projectDir, "app", "utils"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "utils", "helpers.ts"),
          "export function helper() {}",
        );

        const routes = await collectAppRoutes(await getAdapter(), context.projectDir);

        assertEquals(routes.length, 0);
      });
    });
  });
});
