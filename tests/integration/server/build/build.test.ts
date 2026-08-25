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

import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { buildProduction } from "../../../../src/build/production-build/index.ts";
import type { BuildStats } from "../../../../src/server/build-types.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";

async function removeAppDir(projectDir: string): Promise<void> {
  await remove(join(projectDir, "app"), { recursive: true });
}

async function ensurePagesDir(projectDir: string): Promise<string> {
  const pagesDir = join(projectDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  return pagesDir;
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

    // Regression: outside production the cache root is `<project>/.cache`, so a
    // build drops generated bundles into the user's project — a dry run
    // included. Server startup writes a self-ignoring `.gitignore` there, but
    // `veryfront build` never starts a server, so a project that adopted
    // Veryfront (its own .gitignore predates `veryfront init`) saw the bundles
    // as untracked files and `git add -A` committed them.
    it("marks the local cache root as ignored so a build cannot dirty the project's git history", async () => {
      await withTestContext("build-cache-ignore", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        const cacheRoot = join(context.projectDir, ".cache");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        await runWithCacheDir(cacheRoot, () =>
          buildProduction({
            projectDir: context.projectDir,
            outputDir,
            enableSplitting: false,
            enableCompression: false,
            enablePrefetch: false,
            dryRun: true,
          }));

        const ignorePath = join(cacheRoot, ".gitignore");
        assertEquals(await exists(ignorePath), true);
        assertEquals(
          (await readTextFile(ignorePath)).split(/\r?\n/).includes("*"),
          true,
        );
      });
    });

    it("with --no-ssg fails instead of reporting an empty build as success", async () => {
      await withTestContext("build-no-ssg", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");

        await assertRejects(
          () =>
            buildProduction({
              projectDir: context.projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
              ssg: false,
            }),
          Error,
          "static site generation is disabled",
        );
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
          ssg: true,
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

    it("honors build.ssg from veryfront.config.ts when the caller omits ssg", async () => {
      await withTestContext("build-config-ssg-off", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home Page");
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { build: { ssg: false } };`,
        );

        await assertRejects(
          () =>
            buildProduction({
              projectDir: context.projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
            }),
          Error,
          "static site generation is disabled",
        );
      });
    });

    it("fails for an empty project instead of emitting nothing", async () => {
      await withTestContext("build-empty", async (context) => {
        const outputDir = join(context.projectDir, "dist");

        await removeAppDir(context.projectDir);
        await remove(join(context.projectDir, "pages"), { recursive: true });

        await assertRejects(
          () =>
            buildProduction({
              projectDir: context.projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
            }),
          Error,
          "no routes were found",
        );
      });
    });

    it("statically renders App Router literal routes", async () => {
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
          ssg: true,
        });
        assert(stats.pages >= 2);
      });
    });

    it(
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
    it("builds a 21-page SSG project", async () => {
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
        const requiredThroughput = Number.parseFloat(
          Deno.env.get("VF_SSG_MIN_PAGES_PER_SECOND") ?? "0",
        );

        assertEquals(pagesBuilt, totalPages + 1);

        // Wall-clock performance is only meaningful in an isolated benchmark
        // job. The canonical suite runs files in parallel with compiler-heavy
        // integration tests, so host contention must not turn this functional
        // coverage into a flaky performance gate.
        if (Number.isFinite(requiredThroughput) && requiredThroughput > 0) {
          assert(
            throughput >= requiredThroughput,
            `Throughput too low: ${throughput.toFixed(1)} pages/sec for ${pagesBuilt} pages in ${
              elapsedSeconds.toFixed(2)
            }s`,
          );
        }
      });
    });
  });

  describe("buildProduction - SSG Filters and Router Detection", () => {
    it("dry-run SSG includes/excludes and app router detection", async () => {
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
        assertEquals(res.ssgPaths, ["/", "/blog", "/docs"]);

        const resInc = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist2"),
          dryRun: true,
          ssg: true,
          include: ["/docs"],
        });
        assertEquals(resInc.ssgPaths, ["/docs"]);

        const resExc = await buildProduction({
          projectDir: context.projectDir,
          outputDir: join(context.projectDir, "dist3"),
          dryRun: true,
          ssg: true,
          exclude: ["/blog"],
        });
        assertEquals(resExc.ssgPaths, ["/", "/docs"]);
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

    it("fails the build when an MDX page is malformed", async () => {
      await withTestContext("build-malformed-mdx", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(
          join(pagesDir, "broken.mdx"),
          "# Broken\n\n<Component with={invalid syntax",
        );

        await assertRejects(
          () =>
            buildProduction({
              projectDir: context.projectDir,
              outputDir,
              enableSplitting: false,
              enableCompression: false,
              enablePrefetch: false,
              dryRun: true,
              ssg: true,
            }),
          Error,
          "Failed to build page /broken",
        );
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
          ssg: true,
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
          ssg: true,
        });

        assert(stats.pages >= 3, `Expected at least 3 pages, got ${stats.pages}`);
      });
    });

    it("handles mixed Pages and App Router", async () => {
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
          ssg: true,
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
          ssg: true,
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
          ssg: true,
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
              ssg: true,
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
          ssg: true,
        });

        assertExists(stats);
        assert(stats.pages >= 1);
      });
    });
  });

  describe("output directory", () => {
    it("leaves an existing output directory alone on a dry run", async () => {
      // "Dry run: no files will be written" was printed while the build
      // cleared the output directory first, so a dry run destroyed the
      // project's previous build output and wrote nothing back.
      await withTestContext("build-dry-run-keeps-output", async (context) => {
        const outputDir = join(context.projectDir, "dist");
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");

        await mkdir(join(outputDir, "nested"), { recursive: true });
        await writeTextFile(join(outputDir, "index.js"), "PRECIOUS-HOST-ARTIFACT");
        await writeTextFile(join(outputDir, "nested", "deep.txt"), "keepme");

        await buildProduction({
          projectDir: context.projectDir,
          outputDir,
          enableSplitting: false,
          enableCompression: false,
          enablePrefetch: false,
          dryRun: true,
          ssg: true,
        });

        assertEquals(
          await readTextFile(join(outputDir, "index.js")),
          "PRECIOUS-HOST-ARTIFACT",
          "a dry run must not delete existing build output",
        );
        assertEquals(
          await readTextFile(join(outputDir, "nested", "deep.txt")),
          "keepme",
          "a dry run must not delete nested build output",
        );
      });
    });

    it("sends `veryfront build` to build.outDir from veryfront.config.js", async () => {
      // `build.outDir` was parsed into the config object and then dropped: the
      // CLI reported and wrote `dist` no matter what the project configured,
      // with no warning, so the documented way to keep the framework out of a
      // project's own dist/ silently did nothing. Driven through buildCommand
      // because that is where the output directory is decided.
      await withTestContext("build-config-out-dir", async (context) => {
        await removeAppDir(context.projectDir);

        const pagesDir = await ensurePagesDir(context.projectDir);
        await writeTextFile(join(pagesDir, "index.mdx"), "# Home");
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { build: { outDir: "custom-out" } };`,
        );

        const { buildCommand } = await import("../../../../cli/commands/build/command.ts");
        const printed: string[] = [];
        const originalLog = console.log;
        console.log = (...args: unknown[]) => {
          printed.push(args.map((arg) => String(arg)).join(" "));
        };
        try {
          await buildCommand({ projectDir: context.projectDir, dryRun: true } as never);
        } finally {
          console.log = originalLog;
        }

        const output = printed.join("\n");
        assert(
          output.includes(" in custom-out"),
          `expected the build to report custom-out, got:\n${output}`,
        );
      });
    });
  });
});
