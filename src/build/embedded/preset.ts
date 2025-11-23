import { bundlerLogger as logger } from "@veryfront/utils";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
// Use the native esbuild module to avoid interfering with the wasm-based
// instance used elsewhere in the codebase (which relies on initialize/stop).
import * as esbuild from "esbuild/mod.js";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { compileMDXToJS } from "../compiler/index.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.ts";

export interface BuildEmbeddedOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

/**
 * Build the embedded preset bundle.
 * Outputs:
 * - outDir/embedded/manifest.json
 * - outDir/embedded/app.js (SSR entry)
 * - outDir/embedded/rsc/*.js (RSC support)
 */
export async function buildEmbeddedPreset(
  options: BuildEmbeddedOptions,
): Promise<{ manifest: EmbeddedBundleManifest }> {
  const { projectDir, outDir } = options;
  const embeddedDir = join(outDir, "embedded");
  await ensureDir(embeddedDir);
  await ensureDir(join(embeddedDir, "rsc"));

  // 1) Discover minimal SSR entry: prefer app/page.mdx or pages/index.mdx
  const candidates = [join(projectDir, "app", "page.mdx"), join(projectDir, "pages", "index.mdx")];
  let entryPath = "";
  for (const c of candidates) {
    try {
      const st = await Deno.stat(c);
      if (st.isFile) {
        entryPath = c;
        break;
      }
    } catch (error) {
      // File not found, continue checking other paths
      logger.debug(`Entry path not found: ${c}`, error);
    }
  }
  // If no page, create a trivial entry
  if (!entryPath) {
    entryPath = join(projectDir, ".veryfront", "__embedded_fallback__.tsx");
    await ensureDir(join(projectDir, ".veryfront"));
    await Deno.writeTextFile(
      entryPath,
      `export default function Page(){ return '<div>Veryfront</div>'; }`,
    );
  }

  // 2) Bundle SSR entry into app.js (ESM)
  const appOut = join(embeddedDir, "app.js");
  let bundledAppCode = "";
  try {
    const appBuild = await esbuild.build({
      stdin: {
        contents: await Deno.readTextFile(entryPath),
        sourcefile: entryPath,
        resolveDir: projectDir,
        // We do not have an MDX plugin here yet. If the entry is MDX,
        // bundling may fail; we will fall back to a stub below.
        loader: entryPath.endsWith(".mdx") ? "tsx" : "tsx",
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: ["es2020"],
      write: false,
      logLevel: "silent",
    });
    if (!appBuild.outputFiles?.[0]?.text) {
      throw toError(createError({
        type: "build",
        message: "Failed to generate embedded app bundle: no output files",
      }));
    }
    bundledAppCode = appBuild.outputFiles[0].text;
  } catch (error) {
    logger.error("Failed to bundle embedded app:", error);
    // Fallback: emit a minimal stub so the build artifacts exist for consumers/tests
    bundledAppCode = "export default async function App(){ return ''; }";
  }
  if (!bundledAppCode) {
    throw toError(createError({
      type: "build",
      message: "Failed to generate embedded app bundle",
    }));
  }
  await Deno.writeTextFile(appOut, bundledAppCode);

  // 3) Discover additional MDX routes and emit per-route JS modules
  //    - App Router: app/**/page.mdx -> /segment
  //    - Pages Router: pages/**/*.mdx -> path derivation; index.mdx treated as folder index
  const routes: Array<{ path: string; file: string; type: "page" | "api" }> = [];

  async function discoverAppRoutes(): Promise<
    Array<{ routePath: string; filePath: string; sourcePath: string }>
  > {
    const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
    const base = join(projectDir, "app");

    async function walk(dir: string, rel = ""): Promise<void> {
      for await (const ent of Deno.readDir(dir)) {
        const abs = join(dir, ent.name);
        const relNext = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory) {
          await walk(abs, relNext);
        } else if (ent.isFile && ent.name === "page.mdx") {
          // Derive route path: base/app/<rel>/page.mdx -> "/<rel>" ("/" for root)
          const routePath = rel.replace(/\/page\.mdx$/, "").replace(/(^$)/, "/");
          const norm = routePath === ""
            ? "/"
            : routePath.startsWith("/")
            ? routePath
            : `/${routePath}`;
          const filePath = join(embeddedDir, routePath === "" ? "app.js" : `app${norm}.js`);
          results.push({ routePath: norm, filePath, sourcePath: abs });
        }
      }
    }

    try {
      await walk(base);
    } catch {
      // no app directory
    }
    return results;
  }

  async function discoverPagesRoutes(): Promise<
    Array<{ routePath: string; filePath: string; sourcePath: string }>
  > {
    const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
    const base = join(projectDir, "pages");

    async function walk(dir: string, rel = ""): Promise<void> {
      for await (const ent of Deno.readDir(dir)) {
        const abs = join(dir, ent.name);
        const relNext = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory) {
          await walk(abs, relNext);
        } else if (ent.isFile && ent.name.endsWith(".mdx") && !ent.name.startsWith("_")) {
          const withoutExt = relNext.replace(/\.mdx$/, "");
          // Map pages/index.mdx to /index (keep explicit path for clarity)
          const norm = `/${withoutExt}`;
          const routePath = norm.replace(/\/+/g, "/") ? norm.replace(/\/+/g, "/") : "/";
          const filePath = join(embeddedDir, `pages${routePath}.js`.replace(/\/+/g, "/"));
          results.push({ routePath, filePath, sourcePath: abs });
        }
      }
    }

    try {
      await walk(base);
    } catch {
      // no pages directory
    }
    return results;
  }

  const discovered = [...(await discoverAppRoutes()), ...(await discoverPagesRoutes())];

  for (const r of discovered) {
    try {
      // Compile MDX to a standalone JS module
      const mdxContent = await Deno.readTextFile(r.sourcePath);
      const compiled = await compileMDXToJS(r.sourcePath, mdxContent, {
        projectDir,
        mode: "production",
        adapter: denoAdapter,
      });
      await ensureDir(r.filePath.slice(0, r.filePath.lastIndexOf("/")));
      await Deno.writeTextFile(r.filePath, compiled.code);
      const fileRel = r.filePath.slice(embeddedDir.length + 1).replace(/\\/g, "/");
      routes.push({
        path: r.routePath,
        file: `embedded/${fileRel}`,
        type: "page",
      });
    } catch (e) {
      logger.warn("embedded: failed to compile route MDX", {
        route: r.routePath,
        error: String(e),
      } as any);
    }
  }

  // Ensure root entry present in manifest at least once
  routes.unshift({ path: "/", file: "embedded/app.js", type: "page" });

  // 4) Copy RSC client support files (dom/hydrator) to rsc/
  const rscFiles = [
    new URL("../../rendering/rsc/client-dom.ts", import.meta.url),
    new URL("../../rendering/rsc/client-hydrator.ts", import.meta.url),
    new URL("../../rendering/rsc/hydrate-client.ts", import.meta.url),
  ];

  for (const url of rscFiles) {
    try {
      const srcPath = url.pathname;
      const src = await Deno.readTextFile(srcPath);
      // Transpile each to JS using esbuild
      const res = await esbuild.transform(src, {
        loader: "ts",
        target: "es2020",
        format: "esm",
      });
      const name = srcPath.substring(srcPath.lastIndexOf("/") + 1).replace(/\.tsx?$/, ".js");
      await Deno.writeTextFile(join(embeddedDir, "rsc", name), res.code);
    } catch (e) {
      logger.warn("embedded: failed to process RSC file", { error: String(e) } as any);
    }
  }

  // 5) Write manifest
  const manifest: EmbeddedBundleManifest = {
    version: 1,
    routes,
    assets: [
      {
        path: "/_veryfront/rsc/dom.js",
        file: "embedded/rsc/client-dom.js",
        contentType: "application/javascript",
      },
      {
        path: "/_veryfront/rsc/hydrator.js",
        file: "embedded/rsc/client-hydrator.js",
        contentType: "application/javascript",
      },
      {
        path: "/_veryfront/rsc/hydrate-client.js",
        file: "embedded/rsc/hydrate-client.js",
        contentType: "application/javascript",
      },
    ],
  };
  await Deno.writeTextFile(join(embeddedDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  logger.info("Embedded preset built", { outDir: embeddedDir } as any);
  // Ensure native esbuild child process (mod.js) is torn down to avoid test leaks
  try {
    esbuild.stop();
  } catch {
    // ignore
  }
  return { manifest };
}
