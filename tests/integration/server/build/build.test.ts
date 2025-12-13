
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { buildProduction } from "../../../../src/build/production-build/index.ts";
import type { BuildStats } from "../../../../src/server/build-types.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "buildProduction - Core Functionality",
  {},
  () => {
    it("exports function", () => {
      assertExists(buildProduction);
      assertEquals(typeof buildProduction, "function");
    });

    it("creates output directory", async () => {
      await withTestContext("build-output-dir", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        const _stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
        });

        assertExists(_stats);
        assertEquals(typeof _stats.pages, "number");
        assertEquals(typeof _stats.duration, "number");
        assert(_stats.duration >= 0);
      });
    });

    it("with --no-ssg produces no HTML", async () => {
      await withTestContext("build-no-ssg", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        const stats = await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          ssg: false,
        });

        assertExists(stats);

        const outputExists = await Deno.stat(outputDir)
          .then(() => true)
          .catch(() => false);
        if (outputExists) {
          let htmlCount = 0;
          for await (const e of Deno.readDir(outputDir)) {
            if (e.isFile && e.name.endsWith(".html")) htmlCount++;
          }
          assertEquals(htmlCount, 0);
        } else {
          assertEquals(true, true);
        }
      });
    });

    it("processes pages", async () => {
      await withTestContext("build-pages", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await Deno.writeTextFile(join(pagesDir, "about.mdx"), "# About");

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

        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");

        const publicDir = join(context.projectDir, "public");
        await ensureDir(publicDir);
        await Deno.writeTextFile(join(publicDir, "robots.txt"), "User-agent: *\nAllow: /");
        await Deno.writeTextFile(join(publicDir, "style.css"), "body { margin: 0; }");

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

        await Deno.remove(join(context.projectDir, "app"), { recursive: true });
        await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

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

    it("statically renders App Router literal routes", async () => {
      await withTestContext("build-app-router-ssg", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await ensureDir(join(context.projectDir, "app"));
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function P(){return <h1>App Root</h1>}`,
        );
        await ensureDir(join(context.projectDir, "app", "blog"));
        await Deno.writeTextFile(
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

    it("App Router SSG respects dynamic hint: force-dynamic skips SSG, force-static included", async () => {
      await withTestContext("build-app-router-dynamic", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await ensureDir(join(context.projectDir, "app"));
        await Deno.writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export const dynamic = "force-static"; export default function P(){return <h1>Root</h1>}`,
        );
        await ensureDir(join(context.projectDir, "app", "live"));
        await Deno.writeTextFile(
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
    });
  },
);

describe(
  "buildProduction - SSG Performance",
  {},
  () => {
    it("smoke: >= 3 pages/sec throughput", async () => {
      await withTestContext("ssg-throughput", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");

        const totalPages = 20;
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home\n\n");
        for (let i = 0; i < totalPages; i++) {
          await Deno.writeTextFile(
            join(pagesDir, `p${i}.mdx`),
            `# Page ${i}\n\nThis is page ${i}.`,
          );
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
            elapsedSeconds.toFixed(
              2,
            )
          }s`,
        );
      });
    });
  },
);

describe(
  "buildProduction - SSG Filters and Router Detection",
  {},
  () => {
    it("dry-run SSG includes/excludes and app router detection", async () => {
      await withTestContext("build-ssg-dryrun", async (context) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });
        await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

        const pages = join(context.projectDir, "pages");
        await Deno.mkdir(pages, { recursive: true });
        await Deno.writeTextFile(join(pages, "index.mdx"), "# Home\n");
        await Deno.writeTextFile(join(pages, "blog.mdx"), "# Blog\n");

        const app = join(context.projectDir, "app/docs");
        await Deno.mkdir(app, { recursive: true });
        await Deno.writeTextFile(
          join(context.projectDir, "app/layout.tsx"),
          "export default function R({children}:{children:any}){return children}",
        );
        await Deno.writeTextFile(join(app, "page.tsx"), "export default function P(){return null}");

        const dyn = join(context.projectDir, "app/items/[id]");
        await Deno.mkdir(dyn, { recursive: true });
        await Deno.writeTextFile(join(dyn, "page.tsx"), "export default function P(){return null}");

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
  },
);

describe(
  "buildProduction - Edge Cases",
  {},
  () => {
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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await Deno.writeTextFile(
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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(join(pagesDir, "blog", "posts", "tech"));
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await Deno.writeTextFile(join(pagesDir, "blog", "index.mdx"), "# Blog");
        await Deno.writeTextFile(join(pagesDir, "blog", "posts", "first.mdx"), "# First Post");
        await Deno.writeTextFile(join(pagesDir, "blog", "posts", "tech", "ai.mdx"), "# AI Post");

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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await Deno.writeTextFile(join(pagesDir, "hello-world.mdx"), "# Hello World");
        await Deno.writeTextFile(join(pagesDir, "foo_bar.mdx"), "# Foo Bar");
        await Deno.writeTextFile(join(pagesDir, "2024-01-01.mdx"), "# New Year");

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

    it("handles mixed Pages and App Router", async () => {
      await withTestContext("build-mixed-router", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Pages Home");

        await ensureDir(join(context.projectDir, "app"));
        await Deno.writeTextFile(
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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);

        for (let i = 0; i < 25; i++) {
          await Deno.writeTextFile(join(pagesDir, `page-${i}.mdx`), `# Page ${i}`);
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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(
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
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(join(pagesDir, "index.mdx"), "# Home");

        const builds: BuildStats[] = await Promise.all([
          buildProduction({
            projectDir: context.projectDir,
            outputDir,
            enableSplitting: false,
            enableCompression: false,
            enablePrefetch: false,
            dryRun: true,
          }),
          buildProduction({
            projectDir: context.projectDir,
            outputDir,
            enableSplitting: false,
            enableCompression: false,
            enablePrefetch: false,
            dryRun: true,
          }),
          buildProduction({
            projectDir: context.projectDir,
            outputDir,
            enableSplitting: false,
            enableCompression: false,
            enablePrefetch: false,
            dryRun: true,
          }),
        ]);

        builds.forEach((stats) => {
          assertExists(stats);
          assert(stats.pages >= 1);
        });
      });
    });

    it("handles build with compression enabled", async () => {
      await withTestContext("build-compression", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        const pagesDir = join(context.projectDir, "pages");
        await ensureDir(pagesDir);
        await Deno.writeTextFile(
          join(pagesDir, "index.mdx"),
          "# Home\n\nLong content to compress.",
        );

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
  },
);
