import { bundlerLogger as logger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import * as esbuild from "esbuild";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { compileMDXToJS } from "../compiler/index.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

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
  const fs = createFileSystem();
  const adapter = await getAdapter();
  await fs.mkdir(embeddedDir, { recursive: true });
  await fs.mkdir(join(embeddedDir, "rsc"), { recursive: true });

  const candidates = [
    join(projectDir, "app", "page.mdx"),
    join(projectDir, "app", "page.md"),
    join(projectDir, "pages", "index.mdx"),
    join(projectDir, "pages", "index.md"),
  ];
  let entryPath = "";
  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isFile) {
        entryPath = c;
        break;
      }
    } catch (error) {
      // File not found, continue checking other paths
      logger.debug(`Entry path not found: ${c}`, error);
    }
  }

  if (!entryPath) {
    entryPath = join(projectDir, ".veryfront", "__embedded_fallback__.tsx");
    await fs.mkdir(join(projectDir, ".veryfront"), { recursive: true });
    await fs.writeTextFile(
      entryPath,
      `export default function Page(){ return '<div>Veryfront</div>'; }`,
    );
  }

  const appOut = join(embeddedDir, "app.js");
  let bundledAppCode = "";
  try {
    const appBuild = await esbuild.build({
      stdin: {
        contents: await fs.readTextFile(entryPath),
        sourcefile: entryPath,
        resolveDir: projectDir,
        loader: "tsx",
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
    bundledAppCode = "export default async function App(){ return ''; }";
  }
  if (!bundledAppCode) {
    throw toError(createError({
      type: "build",
      message: "Failed to generate embedded app bundle",
    }));
  }
  await fs.writeTextFile(appOut, bundledAppCode);

  const routes: Array<{ path: string; file: string; type: "page" | "api" }> = [];

  async function discoverAppRoutes(): Promise<
    Array<{ routePath: string; filePath: string; sourcePath: string }>
  > {
    const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
    const base = join(projectDir, "app");

    async function walk(dir: string, rel = ""): Promise<void> {
      for await (const ent of fs.readDir(dir)) {
        const abs = join(dir, ent.name);
        const relNext = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory) {
          await walk(abs, relNext);
        } else if (ent.isFile && (ent.name === "page.mdx" || ent.name === "page.md")) {
          const routePath = rel.replace(/\/page\.(mdx|md)$/, "").replace(/(^$)/, "/");
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
      for await (const ent of fs.readDir(dir)) {
        const abs = join(dir, ent.name);
        const relNext = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory) {
          await walk(abs, relNext);
        } else if (
          ent.isFile && (ent.name.endsWith(".mdx") || ent.name.endsWith(".md")) &&
          !ent.name.startsWith("_")
        ) {
          const withoutExt = relNext.replace(/\.(mdx|md)$/, "");
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
      const mdxContent = await fs.readTextFile(r.sourcePath);
      const compiled = await compileMDXToJS(r.sourcePath, mdxContent, {
        projectDir,
        mode: "production",
        adapter,
      });
      await fs.mkdir(r.filePath.slice(0, r.filePath.lastIndexOf("/")), { recursive: true });
      await fs.writeTextFile(r.filePath, compiled.code);
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
      } as unknown);
    }
  }

  routes.unshift({ path: "/", file: "embedded/app.js", type: "page" });

  const rscFiles = [
    new URL("../../rendering/rsc/client-dom.ts", import.meta.url),
    new URL("../../rendering/rsc/client-hydrator.ts", import.meta.url),
    new URL("../../rendering/rsc/hydrate-client.ts", import.meta.url),
  ];

  for (const url of rscFiles) {
    try {
      const srcPath = url.pathname;
      const src = await fs.readTextFile(srcPath);
      const res = await esbuild.transform(src, {
        loader: "ts",
        target: "es2020",
        format: "esm",
      });
      const name = srcPath.substring(srcPath.lastIndexOf("/") + 1).replace(/\.tsx?$/, ".js");
      await fs.writeTextFile(join(embeddedDir, "rsc", name), res.code);
    } catch (e) {
      logger.warn("embedded: failed to process RSC file", { error: String(e) } as unknown);
    }
  }

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
  await fs.writeTextFile(join(embeddedDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  logger.info("Embedded preset built", { outDir: embeddedDir } as unknown);

  // Only stop esbuild if not in test mode with global initialization
  if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
    try {
      esbuild.stop();
    } catch {
      // ignore
    }
  }
  return { manifest };
}
