/**
 * Build Production Tests
 *
 * Tests the production build system:
 * - Basic build functionality
 * - SSG (Static Site Generation)
 * - Pages and App Router support
 * - Asset handling
 * - Build performance
 * - Dynamic vs static route detection
 */

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { mkdir, readDir, remove, stat, writeTextFile } from "#veryfront/compat/fs.ts";
import { buildProduction } from "../../../../src/build/production-build/index.ts";
import type { BuildStats } from "../../../../src/server/build-types.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

async function removeAppDir(projectDir: string): Promise<void> {
  await remove(join(projectDir, "app"), { recursive: true });
}

async function ensurePagesDir(projectDir: string): Promise<string> {
  const pagesDir = join(projectDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  return pagesDir;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("Build Production Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("buildProduction - Core Functionality", () => {
    it("exports function", () => {
      assertExists(buildProduction);
      assertEquals(typeof buildProduction, "function");
    });

    it("creates output directory", async () => {
      await withTestContext("build-output-dir", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(stats);
        assertEquals(typeof stats.pages, "number");
        assertEquals(typeof stats.duration, "number");
        assert(stats.duration >= 0);
      });
    });

    it("with --no-ssg produces no HTML", async () => {
      await withTestContext("build-no-ssg", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          ssg: false,
        });

        assertExists(stats);

        if (!(await dirExists(outputDir))) return;

        let htmlCount = 0;
        for await (const e of readDir(outputDir)) {
          if (e.isFile && e.name.endsWith(".html")) htmlCount++;
        }
        assertEquals(htmlCount, 0);
      });
    });

    it("processes pages", async () => {
      await withTestContext("build-pages", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(join(pagesDir, "about.mdx"), "# About");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assert(stats.pages >= 2);
      });
    });

    it("copies static assets", async () => {
      await withTestContext("build-assets", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");

        const publicDir = join(context.projectDir, "public");
        await mkdir(publicDir, { recursive: true });
        await writeTextFile(join(publicDir, "robots.txt"), "User-agent: *\nAllow: /");
        await writeTextFile(join(publicDir, "style.css"), "body { margin: 0; }");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assert(stats.assets >= 2);
      });
    });

    it("handles empty project", async () => {
      await withTestContext("build-empty", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);
        await remove(join(context.projectDir, "pages"), { recursive: true });

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        });

        assertExists(stats);
        assertEquals(stats.pages, 0);
        assertEquals(stats.assets, 0);
      });
    });

    // TODO: Re-enable after investigating App Router SSG regression
    it.ignore("statically renders App Router literal routes", async () => {
      await withTestContext("build-app-router-ssg", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function P(){return <h1>App Root</h1>}`,
        );
        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.tsx"),
          `export default function P(){return <div>Blog Index</div>}`,
        );

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });
        assert(stats.pages >= 2);
      });
    });

    // TODO: Re-enable after investigating App Router SSG regression
    it.ignore(
      "App Router SSG respects dynamic hint: force-dynamic skips SSG, force-static included",
      async () => {
        await withTestContext("build-app-router-dynamic", async (context) => {
          const outputDir = join(context.projectDir, "dist");

          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export const dynamic = "force-static"; export default function P(){return <h1>Root</h1>}`,
          );

          await mkdir(join(context.projectDir, "app", "live"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "live", "page.tsx"),
            `export const dynamic = "force-dynamic"; export default function P(){return <h1>Live</h1>}`,
          );

          const stats = await buildProduction({
            projectDir: context.projectDir,
            outputDir,
            enableSplitting: false,
            enableCompression: false,
            enablePrefetch: false,
            dryRun: true,
          });

          assert(stats.pages >= 1);
        });
      },
    );
  });

  describe("buildProduction - SSG Performance", () => {
    it("smoke: >= 3 pages/sec throughput", async () => {
      await withTestContext("ssg-throughput", async (context) => {
        await removeAppDir(context.projectDir);

        const pagesDir = join(context.projectDir, "pages");

        const totalPages = 20;
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home\n\n");
        for (let i = 0; i < totalPages; i++) {
          await writeTextFile(join(pagesDir, `p${i}.mdx`), `# Page ${i}\n\nThis is page ${i}.`);
        }

        const start = performance.now();
        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist"),
          ssg: true,
          dryRun: true,
          enableSplitting: false,
          enablePrefetch: false,
          enableCompression: false,
        });
        const elapsedSeconds = (performance.now() - start) / 1000;

        const pagesBuilt = stats.pages;
        const throughput = pagesBuilt / elapsedSeconds;

        assert(
          throughput >= 3,
          `Throughput too low: ${throughput.toFixed(1)} pages/sec for ${pagesBuilt} pages in ${
            elapsedSeconds.toFixed(2)
          }s`,
        );
      });
    });
  });

  describe("buildProduction - SSG Filters and Router Detection", () => {
    // TODO: Re-enable after investigating App Router SSG regression
    it.ignore("dry-run SSG includes/excludes and app router detection", async () => {
      await withTestContext("build-ssg-dryrun", async (context) => {
        await removeAppDir(context.projectDir);
        await remove(join(context.projectDir, "pages"), { recursive: true });

        const pages = join(context.projectDir, "pages");
        await mkdir(pages, { recursive: true });
        await writeTextFile(join(pages, "index.mdx"), "# Home\n");
        await writeTextFile(join(pages, "blog.mdx"), "# Blog\n");

        const app = join(context.projectDir, "app/docs");
        await mkdir(app, { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app/layout.tsx"),
          "export default function R({children}:{children:any}){return children}",
        );
        await writeTextFile(join(app, "page.tsx"), "export default function P(){return null}");

        const dyn = join(context.projectDir, "app/items/[id]");
        await mkdir(dyn, { recursive: true });
        await writeTextFile(join(dyn, "page.tsx"), "export default function P(){return null}");

        const res = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist"),
          dryRun: true,
          ssg: true,
        });
        assert((res as any).ssgPaths);
        console.log("All SSG paths without filter:", (res as any).ssgPaths);

        const resInc = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist2"),
          dryRun: true,
          ssg: true,
          include: ["/", "/docs"],
        });
        const inc = (resInc as any).ssgPaths as string[];
        console.log("SSG paths with include filter:", inc);

        assert(inc.includes("/docs"));
        assertEquals(inc.includes("/blog"), false);
        assertEquals(inc.includes("/"), false);

        const resExc = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist3"),
          dryRun: true,
          ssg: true,
          exclude: ["/blog"],
        });
        const exc = (resExc as any).ssgPaths as string[];
        assertEquals(exc.includes("/blog"), false);
      });
    });
  });

  describe("buildProduction - Edge Cases", () => {
    it("handles invalid project directory", async () => {
      let thrown = false;

      try {
        await buildProduction({
          projectDir: "/nonexistent/path/to/project",
          outputDir: "/tmp/output",
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
        });
      } catch (error) {
        thrown = true;
        assertExists(error);
      }

      assertEquals(thrown, true);
    });

    it("handles malformed MDX files gracefully", async () => {
      await withTestContext("build-malformed-mdx", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(
          join(pagesDir, "broken.mdx"),
          "# Broken\n\n<Component with={invalid syntax",
        );

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(stats);
        assert(stats.pages >= 1);
      });
    });

    it("handles deeply nested page structures", async () => {
      await withTestContext("build-nested", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = join(context.projectDir, "pages");
        await mkdir(join(pagesDir, "blog", "posts", "tech"), { recursive: true });
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(join(pagesDir, "blog", "index.mdx"), "# Blog");
        await writeTextFile(join(pagesDir, "blog", "posts", "first.mdx"), "# First Post");
        await writeTextFile(join(pagesDir, "blog", "posts", "tech", "ai.mdx"), "# AI Post");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assert(stats.pages >= 4);
      });
    });

    it("handles files with special characters in names", async () => {
      await withTestContext("build-special-chars", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(join(pagesDir, "hello-world.mdx"), "# Hello World");
        await writeTextFile(join(pagesDir, "foo_bar.mdx"), "# Foo Bar");
        await writeTextFile(join(pagesDir, "2024-01-01.mdx"), "# New Year");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assert(stats.pages >= 3, `Expected at least 3 pages, got ${stats.pages}`);
      });
    });

    // TODO: Re-enable after investigating App Router SSG regression
    it.ignore("handles mixed Pages and App Router", async () => {
      await withTestContext("build-mixed-router", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Pages Home");

        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          "export default function P(){return <h1>App Home</h1>}",
        );

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(stats);
        assert(stats.pages >= 2);
      });
    });

    it("handles very large number of pages", async () => {
      await withTestContext("build-large-scale", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);

        for (let i = 0; i < 25; i++) {
          await writeTextFile(join(pagesDir, `page-${i}.mdx`), `# Page ${i}`);
        }

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertEquals(stats.pages, 25);
      });
    });

    it("handles empty frontmatter", async () => {
      await withTestContext("build-empty-frontmatter", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(
          join(pagesDir, "index.mdx"),
          "# Home\n\nContent without frontmatter data.",
        );

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(stats);
        assert(stats.pages >= 1, `Expected at least 1 page, got ${stats.pages}`);
      });
    });

    it("handles concurrent dry-run builds", async () => {
      await withTestContext("build-concurrent", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");

        const builds: BuildStats[] = await Promise.all(
          Array.from({ length: 3 }, () =>
            buildProduction({
              projectDir: context.projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
              dryRun: true,
            })),
        );

        for (const stats of builds) {
          assertExists(stats);
          assert(stats.pages >= 1);
        }
      });
    });

    it("handles build with compression enabled", async () => {
      await withTestContext("build-compression", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home\n\nLong content to compress.");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: true,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(stats);
        assert(stats.pages >= 1);
      });
    });
  });
});
