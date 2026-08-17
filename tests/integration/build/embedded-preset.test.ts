import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, readTextFile, writeTextFile } from "#veryfront/testing/deno-compat";
import { buildEmbeddedPreset, presetBasename } from "../../../src/build/embedded/preset.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

// Dynamic imports of built JSX code require react/jsx-runtime resolution
// which only works reliably in Deno (can resolve npm packages from anywhere)
const denoOnlyIt = isDeno ? it : it.skip;

describe(
  "Embedded preset (scaffold)",
  () => {
    it("builds minimal manifest and outputs under embedded/", async () => {
      await withTestContext("embedded-preset", async (context) => {
        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "page.mdx"),
          "# Hello",
        );

        const outDir = join(context.projectDir, "dist");
        await mkdir(outDir, { recursive: true });

        const { manifest } = await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
          config: { router: "app" },
        });

        assertEquals(manifest.version, 1);
        assert(Array.isArray(manifest.routes));
        assert(Array.isArray(manifest.assets));

        const manifestText = await readTextFile(
          join(outDir, "embedded", "manifest.json"),
        );
        assert(manifestText.includes("embedded/app.js"));

        const appJs = await readTextFile(join(outDir, "embedded", "app.js"));
        assert(appJs.length > 0);
      });
    });

    it("discovers multiple routes and includes RSC assets", async () => {
      await withTestContext("embedded-preset-routes", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await mkdir(outDir, { recursive: true });

        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Root");
        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.mdx"),
          "# Blog",
        );

        await mkdir(join(context.projectDir, "pages", "docs"), {
          recursive: true,
        });
        await writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Index",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "docs", "guide.mdx"),
          "# Guide",
        );

        const { manifest } = await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });

        assert(Array.isArray(manifest.routes));
        assert(manifest.routes.length >= 4);

        const routePaths = new Set(manifest.routes.map((r) => r.path));
        assert(routePaths.has("/"));
        assert(routePaths.has("/blog"));
        assert(routePaths.has("/index"));
        assert(routePaths.has("/docs/guide"));

        const assetPaths = new Set(manifest.assets.map((a) => a.path));
        assert(assetPaths.has("/_veryfront/rsc/dom.js"));
        assert(assetPaths.has("/_veryfront/rsc/hydrate-client.js"));

        const filesToCheck = [
          join(outDir, "embedded", "app.js"),
          join(outDir, "embedded", "app", "blog.js"),
          join(outDir, "embedded", "pages", "index.js"),
          join(outDir, "embedded", "pages", "docs", "guide.js"),
        ];

        for (const filePath of filesToCheck) {
          const code = await readTextFile(filePath);
          assert(code.length > 0);
        }
      });
    });

    it("publishes a root page once, under a non-empty artifact name", async () => {
      await withTestContext("embedded-preset-root-page", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await mkdir(outDir, { recursive: true });

        await mkdir(join(context.projectDir, "app", "about"), {
          recursive: true,
        });
        await writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Root");
        await writeTextFile(
          join(context.projectDir, "app", "about", "page.mdx"),
          "# About",
        );

        const { manifest } = await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });

        // No route may name an artifact with an empty basename — `embedded/app/.js`
        // is a dotfile, which consumers that prune dotfiles drop silently.
        const emptyBasename = manifest.routes.filter((r) => presetBasename(r.file).startsWith("."));
        assertEquals(
          emptyBasename,
          [],
          `routes must not name dotfile artifacts: ${JSON.stringify(manifest.routes)}`,
        );

        // `/` must resolve without the consumer having to guess a precedence rule.
        const rootRoutes = manifest.routes.filter((r) => r.path === "/");
        assertEquals(
          rootRoutes.length,
          1,
          `"/" must appear once: ${JSON.stringify(manifest.routes)}`,
        );

        // The one `/` route must point at a real, non-empty artifact.
        const rootCode = await readTextFile(
          join(outDir, ...rootRoutes[0].file.split("/")),
        );
        assert(rootCode.length > 0);

        // Sibling routes are unaffected.
        const routePaths = manifest.routes.map((r) => r.path).sort();
        assertEquals(routePaths, ["/", "/about"]);
      });
    });

    denoOnlyIt("app.js is dynamically importable (syntax smoke)", async () => {
      await withTestContext("embedded-preset-import-smoke", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await mkdir(outDir, { recursive: true });

        await mkdir(join(context.projectDir, "app"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "page.mdx"),
          "# Hello Import",
        );

        await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });

        const spec = `file://${join(outDir, "embedded", "app.js")}`;
        const mod: Record<string, unknown> = await import(spec);
        assert(typeof mod === "object");
      });
    });

    it("per-route JS modules export default (text shape)", async () => {
      await withTestContext("embedded-preset-export-shape", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await mkdir(outDir, { recursive: true });

        await mkdir(join(context.projectDir, "app", "blog"), { recursive: true });
        await mkdir(join(context.projectDir, "pages", "docs"), {
          recursive: true,
        });

        await writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Root");
        await writeTextFile(
          join(context.projectDir, "app", "blog", "page.mdx"),
          "# Blog",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Index",
        );
        await writeTextFile(
          join(context.projectDir, "pages", "docs", "guide.mdx"),
          "# Guide",
        );

        await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });

        const files = [
          join(outDir, "embedded", "app", "blog.js"),
          join(outDir, "embedded", "pages", "index.js"),
          join(outDir, "embedded", "pages", "docs", "guide.js"),
        ];

        for (const filePath of files) {
          const code = await readTextFile(filePath);
          assert(code.includes("export default") || /export\s+\{/.test(code));
        }
      });
    });

    it("publishes a path once when an app route and a pages route collide", async () => {
      // Raised in review: the `/` claim is part of a gate spanning app AND pages
      // routes, broader than the root-page defect and untested. It is the correct
      // behaviour — a manifest with two entries for one path is ambiguous — so it
      // is pinned rather than narrowed. On origin/main this fixture published
      // `/docs` twice: embedded/app/docs.js and embedded/pages/docs.js.
      const projectDir = await Deno.makeTempDir({ prefix: "vf-embedded-collide-" });
      try {
        await Deno.mkdir(join(projectDir, "app/docs"), { recursive: true });
        await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
        await Deno.writeTextFile(join(projectDir, "app/page.mdx"), "# Root\n");
        await Deno.writeTextFile(join(projectDir, "app/docs/page.mdx"), "# App docs\n");
        await Deno.writeTextFile(join(projectDir, "pages/docs.mdx"), "# Pages docs\n");

        const { manifest } = await buildEmbeddedPreset({
          projectDir,
          outDir: join(projectDir, "dist"),
          runtime: "deno",
        });

        const paths = manifest.routes.map((route) => route.path);
        assertEquals(
          paths.length,
          new Set(paths).size,
          `every path must be published once: ${JSON.stringify(manifest.routes)}`,
        );
        const docs = manifest.routes.filter((route) => route.path === "/docs");
        assertEquals(docs.length, 1);
        assertEquals(docs[0].file, "embedded/app/docs.js");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects duplicate paths within the selected router", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-embedded-route-conflict-" });
      try {
        await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
        await Deno.writeTextFile(join(projectDir, "pages/index.mdx"), "# Home\n");
        await Deno.writeTextFile(join(projectDir, "pages/about.mdx"), "# MDX about\n");
        await Deno.writeTextFile(join(projectDir, "pages/about.md"), "# MD about\n");

        await assertRejects(
          () =>
            buildEmbeddedPreset({
              projectDir,
              outDir: join(projectDir, "dist"),
              runtime: "deno",
              config: { router: "pages" },
            }),
          Error,
          'Multiple Pages Router files resolve to "/about"',
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("honours an explicit pages router for the shell and route collisions", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-embedded-pages-router-" });
      try {
        await Deno.mkdir(join(projectDir, "app/docs"), { recursive: true });
        await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
        await Deno.writeTextFile(
          join(projectDir, "app/page.mdx"),
          "# App root\n\nAPP_ROUTER_ROOT_MARKER\n",
        );
        await Deno.writeTextFile(join(projectDir, "app/docs/page.mdx"), "# App docs\n");
        await Deno.writeTextFile(
          join(projectDir, "pages/index.mdx"),
          "# Pages root\n\nPAGES_ROUTER_ROOT_MARKER\n",
        );
        await Deno.writeTextFile(join(projectDir, "pages/docs.mdx"), "# Pages docs\n");

        const outDir = join(projectDir, "dist");
        const { manifest, pagesIndexIsShell } = await buildEmbeddedPreset({
          projectDir,
          outDir,
          runtime: "deno",
          config: { router: "pages" },
        });

        assertEquals(pagesIndexIsShell, true);

        const docs = manifest.routes.filter((route) => route.path === "/docs");
        assertEquals(docs, [{
          path: "/docs",
          file: "embedded/pages/docs.js",
          type: "page",
        }]);

        const shell = await readTextFile(join(outDir, "embedded/app.js"));
        assert(shell.includes("PAGES_ROUTER_ROOT_MARKER"));
        assertEquals(shell.includes("APP_ROUTER_ROOT_MARKER"), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("publishes a valid colliding fallback after the preferred route fails", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-embedded-route-fallback-" });
      try {
        await Deno.mkdir(join(projectDir, "app/docs"), { recursive: true });
        await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
        await Deno.writeTextFile(join(projectDir, "app/page.mdx"), "# Root\n");
        await Deno.writeTextFile(
          join(projectDir, "app/docs/page.mdx"),
          "<UnclosedComponent\n",
        );
        await Deno.writeTextFile(join(projectDir, "pages/docs.mdx"), "# Pages docs\n");

        const { manifest } = await buildEmbeddedPreset({
          projectDir,
          outDir: join(projectDir, "dist"),
          runtime: "deno",
        });

        assertEquals(
          manifest.routes.filter((route) => route.path === "/docs"),
          [{ path: "/docs", file: "embedded/pages/docs.js", type: "page" }],
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  },
);
