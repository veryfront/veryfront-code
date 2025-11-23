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

import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../_helpers/log-guard.ts";
import { collectAppRoutes, collectPagesRoutes } from "../../../src/server/build-routes.ts";
import type { AppRouteInfo, RouteInfo } from "../../../src/server/build-types.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

// Clean up renderer intervals to prevent resource leaks
afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Route Discovery - Pages Router",
  {},
  () => {
    it("should collect basic index route", async () => {
      await withTestContext("routes-pages-index", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.tsx"),
          "export default function Home() { return <div>Home</div> }",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/");
        assertEquals(routes[0]!.slug, "index");
        assert(routes[0]!.file.endsWith("pages/index.tsx"));
      });
    });

    it("should collect nested routes", async () => {
      await withTestContext("routes-pages-nested", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "blog", "index.tsx"),
          "export default function Blog() { return <div>Blog</div> }",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() { return <div>Post</div> }",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 2);
        const paths = routes.map((r: RouteInfo) => r.path).sort();
        assertEquals(paths, ["/blog", "/blog/post"]);
      });
    });

    it("should handle deeply nested routes", async () => {
      await withTestContext("routes-pages-deep-nested", async (context) => {
        // Arrange
        const deepPath = join(context.projectDir, "pages", "a", "b", "c", "d");
        await Deno.mkdir(deepPath, { recursive: true });
        await Deno.writeTextFile(
          join(deepPath, "page.tsx"),
          "export default function Deep() { return <div>Deep</div> }",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/a/b/c/d/page");
      });
    });

    it("should handle multiple file extensions", async () => {
      await withTestContext("routes-pages-extensions", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "tsx-page.tsx"),
          "export default function TsxPage() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "jsx-page.jsx"),
          "export default function JsxPage() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "ts-page.ts"),
          "export default function TsPage() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "mdx-page.mdx"),
          "# MDX Page",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 4);
        const slugs = routes.map((r: RouteInfo) => r.slug).sort();
        assertEquals(slugs, ["jsx-page", "mdx-page", "ts-page", "tsx-page"]);
      });
    });

    it("should ignore non-page files", async () => {
      await withTestContext("routes-pages-ignore-non-pages", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "page.tsx"),
          "export default function Page() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "styles.css"),
          "body { margin: 0; }",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "data.json"),
          '{"key": "value"}',
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "README.md"),
          "# README",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.slug, "page");
      });
    });

    it("should handle missing pages directory gracefully", async () => {
      await withTestContext("routes-pages-missing-dir", async (context) => {
        // Arrange - remove pages directory
        await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 0);
      });
    });

    it("should filter routes with include pattern", async () => {
      await withTestContext("routes-pages-include", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "pages", "docs"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "docs", "guide.tsx"),
          "export default function Guide() {}",
        );

        // Act
        const routes = await collectPagesRoutes(
          denoAdapter,
          context.projectDir,
          ["/blog"],
        );

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog/post");
      });
    });

    it("should filter routes with exclude pattern", async () => {
      await withTestContext("routes-pages-exclude", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "pages", "admin"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "blog", "post.tsx"),
          "export default function Post() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "admin", "dashboard.tsx"),
          "export default function Dashboard() {}",
        );

        // Act
        const routes = await collectPagesRoutes(
          denoAdapter,
          context.projectDir,
          undefined,
          ["/admin"],
        );

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog/post");
      });
    });

    it("should handle special characters in filenames", async () => {
      await withTestContext("routes-pages-special-chars", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "hello-world.tsx"),
          "export default function HelloWorld() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "my_page.tsx"),
          "export default function MyPage() {}",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 2);
        const slugs = routes.map((r: RouteInfo) => r.slug).sort();
        assertEquals(slugs, ["hello-world", "my_page"]);
      });
    });

    it("should handle index routes in subdirectories", async () => {
      await withTestContext("routes-pages-subdirectory-index", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "products", "index.tsx"),
          "export default function Products() {}",
        );

        // Act
        const routes = await collectPagesRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/products");
        assertEquals(routes[0]!.slug, "products");
      });
    });
  },
);

describe(
  "Route Discovery - App Router",
  {},
  () => {
    it("should collect root page route", async () => {
      await withTestContext("routes-app-root", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "export default function Home() { return <div>Home</div> }",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/");
        assert(routes[0]!.pageFile.endsWith("app/page.tsx"));
        assertEquals(routes[0]!.segments, []);
      });
    });

    it("should collect nested app routes", async () => {
      await withTestContext("routes-app-nested", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "page.tsx"),
          "export default function Blog() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog");
        assertEquals(routes[0]!.segments, ["blog"]);
      });
    });

    it("should skip dynamic segment routes - [id]", async () => {
      await withTestContext("routes-app-dynamic-segment", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "posts"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "posts", "[id]"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "posts", "page.tsx"),
          "export default function Posts() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "posts", "[id]", "page.tsx"),
          "export default function Post() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - dynamic routes should be skipped
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/posts");
      });
    });

    it("should skip catch-all routes - [...slug]", async () => {
      await withTestContext("routes-app-catch-all", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "docs"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "docs", "[...slug]"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "docs", "[...slug]", "page.tsx"),
          "export default function Docs() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - catch-all routes should be skipped
        assertEquals(routes.length, 0);
      });
    });

    it("should skip optional catch-all routes - [[...slug]]", async () => {
      await withTestContext("routes-app-optional-catch-all", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "shop"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "shop", "[[...slug]]"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "shop", "[[...slug]]", "page.tsx"),
          "export default function Shop() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - optional catch-all routes should be skipped
        assertEquals(routes.length, 0);
      });
    });

    it("should detect and skip force-dynamic routes", async () => {
      await withTestContext("routes-app-force-dynamic", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "api-data"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "api-data", "page.tsx"),
          `export const dynamic = 'force-dynamic'
export default function ApiData() {}`,
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - force-dynamic routes should be skipped
        assertEquals(routes.length, 0);
      });
    });

    it("should include static routes without force-dynamic", async () => {
      await withTestContext("routes-app-static", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "about"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "about", "page.tsx"),
          `export const dynamic = 'auto'
export default function About() {}`,
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/about");
      });
    });

    it("should handle missing app directory gracefully", async () => {
      await withTestContext("routes-app-missing-dir", async (context) => {
        // Arrange - remove app directory
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 0);
      });
    });

    it("should prefer page.tsx over other page extensions", async () => {
      await withTestContext("routes-app-page-preference", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "test"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "test", "page.tsx"),
          "export default function Test() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "test", "page.jsx"),
          "export default function Test() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.tsx"));
      });
    });

    it("should handle page.jsx when page.tsx not present", async () => {
      await withTestContext("routes-app-page-jsx", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "jsx-only"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "jsx-only", "page.jsx"),
          "export default function JsxOnly() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.jsx"));
      });
    });

    it("should handle page.ts when other extensions not present", async () => {
      await withTestContext("routes-app-page-ts", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "ts-only"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "ts-only", "page.ts"),
          "export default function TsOnly() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.ts"));
      });
    });

    it("should handle page.js when other extensions not present", async () => {
      await withTestContext("routes-app-page-js", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "js-only"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "js-only", "page.js"),
          "export default function JsOnly() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.js"));
      });
    });

    it("should ignore layout.tsx files", async () => {
      await withTestContext("routes-app-ignore-layout", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "with-layout"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "with-layout", "layout.tsx"),
          "export default function Layout() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "with-layout", "page.tsx"),
          "export default function Page() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - only page.tsx should be collected
        assertEquals(routes.length, 1);
        assert(routes[0]!.pageFile.endsWith("page.tsx"));
      });
    });

    it("should filter app routes with include pattern", async () => {
      await withTestContext("routes-app-include", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "public-area"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "private-area"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "public-area", "page.tsx"),
          "export default function Public() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "private-area", "page.tsx"),
          "export default function Private() {}",
        );

        // Act
        const routes = await collectAppRoutes(
          denoAdapter,
          context.projectDir,
          ["/public-area"],
        );

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/public-area");
      });
    });

    it("should filter app routes with exclude pattern", async () => {
      await withTestContext("routes-app-exclude", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "admin"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "page.tsx"),
          "export default function Blog() {}",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "app", "admin", "page.tsx"),
          "export default function Admin() {}",
        );

        // Act
        const routes = await collectAppRoutes(
          denoAdapter,
          context.projectDir,
          undefined,
          ["/admin"],
        );

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/blog");
      });
    });

    it("should handle deeply nested app routes", async () => {
      await withTestContext("routes-app-deep-nested", async (context) => {
        // Arrange
        const deepPath = join(context.projectDir, "app", "a", "b", "c", "d");
        await Deno.mkdir(deepPath, { recursive: true });
        await Deno.writeTextFile(
          join(deepPath, "page.tsx"),
          "export default function Deep() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertEquals(routes[0]!.path, "/a/b/c/d");
        assertEquals(routes[0]!.segments, ["a", "b", "c", "d"]);
      });
    });

    it("should handle multiple routes at different levels", async () => {
      await withTestContext("routes-app-multiple-levels", async (context) => {
        // Arrange
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "export default function Home() {}",
        );
        await Deno.mkdir(join(context.projectDir, "app", "about"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "about", "page.tsx"),
          "export default function About() {}",
        );
        await Deno.mkdir(join(context.projectDir, "app", "about", "team"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "about", "team", "page.tsx"),
          "export default function Team() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 3);
        const paths = routes.map((r: AppRouteInfo) => r.path).sort();
        assertEquals(paths, ["/", "/about", "/about/team"]);
      });
    });

    it("should track segment directories correctly", async () => {
      await withTestContext("routes-app-segment-dirs", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "blog", "posts"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "blog", "posts", "page.tsx"),
          "export default function Posts() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 1);
        assertExists(routes[0]!.segmentDirs);
        assertEquals(routes[0]!.segmentDirs!.length, 3); // app, blog, posts
      });
    });

    it("should handle force-dynamic with different quote styles", async () => {
      await withTestContext("routes-app-force-dynamic-quotes", async (context) => {
        // Arrange - single quotes
        await Deno.mkdir(join(context.projectDir, "app", "single"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "single", "page.tsx"),
          `export const dynamic = 'force-dynamic'`,
        );

        // double quotes
        await Deno.mkdir(join(context.projectDir, "app", "double"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "double", "page.tsx"),
          `export const dynamic = "force-dynamic"`,
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - both should be skipped
        assertEquals(routes.length, 0);
      });
    });

    it("should handle mixed dynamic and static nested routes", async () => {
      await withTestContext("routes-app-mixed-routes", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "products"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "products", "page.tsx"),
          "export default function Products() {}",
        );
        await Deno.mkdir(join(context.projectDir, "app", "products", "featured"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "products", "featured", "page.tsx"),
          "export default function Featured() {}",
        );
        await Deno.mkdir(join(context.projectDir, "app", "products", "[id]"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "products", "[id]", "page.tsx"),
          "export default function Product() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - only static routes
        assertEquals(routes.length, 2);
        const paths = routes.map((r: AppRouteInfo) => r.path).sort();
        assertEquals(paths, ["/products", "/products/featured"]);
      });
    });

    it("should handle empty app directory", async () => {
      await withTestContext("routes-app-empty", async (context) => {
        // Arrange - app directory exists but has no pages

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert
        assertEquals(routes.length, 0);
      });
    });

    it("should skip directories without page files", async () => {
      await withTestContext("routes-app-no-page-files", async (context) => {
        // Arrange
        await Deno.mkdir(join(context.projectDir, "app", "components"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "components", "Button.tsx"),
          "export default function Button() {}",
        );
        await Deno.mkdir(join(context.projectDir, "app", "utils"), { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "utils", "helpers.ts"),
          "export function helper() {}",
        );

        // Act
        const routes = await collectAppRoutes(denoAdapter, context.projectDir);

        // Assert - no routes since no page files
        assertEquals(routes.length, 0);
      });
    });
  },
);
