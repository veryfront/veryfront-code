import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd.ts";
import { buildEmbeddedPreset } from "../../../src/build/embedded/preset.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to esbuild native process cleanup timing
describe(
  "Embedded preset (scaffold)",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("builds minimal manifest and outputs under embedded/", async () => {
      await withTestContext("embedded-preset", async (context) => {
        // minimal page for entry detection
        await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
        await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Hello");
        const outDir = join(context.projectDir, "dist");
        await Deno.mkdir(outDir, { recursive: true });

        const { manifest } = await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });
        assertEquals(manifest.version, 1);
        assert(Array.isArray(manifest.routes));
        assert(Array.isArray(manifest.assets));

        const manifestPath = join(outDir, "embedded", "manifest.json");
        const text = await Deno.readTextFile(manifestPath);
        assert(text.includes("embedded/app.js"));

        const appJs = await Deno.readTextFile(join(outDir, "embedded", "app.js"));
        assert(appJs.length > 0);
      });
    });

    it("discovers multiple routes and includes RSC assets", async () => {
      await withTestContext("embedded-preset-routes", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await Deno.mkdir(outDir, { recursive: true });

        // app router root and nested
        await Deno.mkdir(join(context.projectDir, "app", "blog"), {
          recursive: true,
        });
        await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Root");
        await Deno.writeTextFile(join(context.projectDir, "app", "blog", "page.mdx"), "# Blog");

        // pages router index and nested
        await Deno.mkdir(join(context.projectDir, "pages", "docs"), {
          recursive: true,
        });
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Index");
        await Deno.writeTextFile(join(context.projectDir, "pages", "docs", "guide.mdx"), "# Guide");

        const { manifest } = await buildEmbeddedPreset({
          projectDir: context.projectDir,
          outDir,
          runtime: "deno",
        });
        // Routes must include at least 4 entries (root + 3 discovered)
        assert(Array.isArray(manifest.routes));
        assert(manifest.routes.length >= 4);

        const routePaths = new Set(manifest.routes.map((r) => r.path));
        // Root always present
        assert(routePaths.has("/"));
        // App/blog page discovered
        assert(routePaths.has("/blog"));
        // Pages index and nested path discovered
        assert(routePaths.has("/index")); // pages/index.mdx maps to "/index"
        assert(routePaths.has("/docs/guide"));

        // RSC assets
        const assetPaths = new Set(manifest.assets.map((a) => a.path));
        assert(assetPaths.has("/_veryfront/rsc/dom.js"));
        assert(assetPaths.has("/_veryfront/rsc/hydrator.js"));
        assert(assetPaths.has("/_veryfront/rsc/hydrate-client.js"));

        // Verify per-route JS files exist
        const filesToCheck = [
          join(outDir, "embedded", "app.js"),
          join(outDir, "embedded", "app", "blog.js"),
          join(outDir, "embedded", "pages", "index.js"),
          join(outDir, "embedded", "pages", "docs", "guide.js"),
        ];
        for (const f of filesToCheck) {
          const code = await Deno.readTextFile(f);
          assert(code.length > 0);
        }
      });
    });

    it("app.js is dynamically importable (syntax smoke)", async () => {
      await withTestContext("embedded-preset-import-smoke", async (context) => {
        const outDir = join(context.projectDir, "dist");
        await Deno.mkdir(outDir, { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
        await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Hello Import");

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
        await Deno.mkdir(outDir, { recursive: true });
        await Deno.mkdir(join(context.projectDir, "app", "blog"), {
          recursive: true,
        });
        await Deno.mkdir(join(context.projectDir, "pages", "docs"), {
          recursive: true,
        });
        await Deno.writeTextFile(join(context.projectDir, "app", "page.mdx"), "# Root");
        await Deno.writeTextFile(join(context.projectDir, "app", "blog", "page.mdx"), "# Blog");
        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Index");
        await Deno.writeTextFile(join(context.projectDir, "pages", "docs", "guide.mdx"), "# Guide");

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
        for (const f of files) {
          const code = await Deno.readTextFile(f);
          // Basic shape: exported module present (either default or named)
          assert(code.includes("export default") || /export\s+\{/.test(code));
        }
      });
    });
  },
);
