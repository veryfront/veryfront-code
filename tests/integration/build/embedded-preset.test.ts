import { assert, assertEquals } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import {
  mkdir,
  readTextFile,
  writeTextFile,
} from "@veryfront/testing/deno-compat";
import { buildEmbeddedPreset } from "../../../src/build/embedded/preset.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

// Dynamic imports of built JSX code require react/jsx-runtime resolution
// which only works reliably in Deno (can resolve npm packages from anywhere)
const denoOnlyIt = isDeno ? it : it.skip;

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
        assert(assetPaths.has("/_veryfront/rsc/hydrator.js"));
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
  },
);
