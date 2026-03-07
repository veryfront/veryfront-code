import { bundlerLogger as logger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import * as esbuild from "esbuild";
import { join } from "#veryfront/compat/path/index.ts";
import { compileMDXToJS } from "../compiler/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
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
  const adapter = await runtime.get();

  await fs.mkdir(embeddedDir, { recursive: true });
  await fs.mkdir(join(embeddedDir, "rsc"), { recursive: true });

  const entryPath = await findOrCreateEntryPath(fs, projectDir);
  const appOut = join(embeddedDir, "app.js");

  const bundledAppCode = await bundleEmbeddedApp({
    fs,
    entryPath,
    projectDir,
    adapter: adapter as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
  });

  await fs.writeTextFile(appOut, bundledAppCode);

  const routes: Array<{ path: string; file: string; type: "page" | "api" }> = [];
  const discovered = [
    ...(await discoverAppRoutes(fs, projectDir, embeddedDir)),
    ...(await discoverPagesRoutes(fs, projectDir, embeddedDir)),
  ];

  for (const r of discovered) {
    try {
      const mdxContent = await fs.readTextFile(r.sourcePath);
      const compiled = await compileMDXToJS(r.sourcePath, mdxContent, {
        projectDir,
        mode: "production",
        adapter,
      });

      await fs.mkdir(dirname(r.filePath), { recursive: true });
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
      const name = basename(srcPath).replace(/\.tsx?$/, ".js");
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

  await fs.writeTextFile(
    join(embeddedDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  logger.info("Embedded preset built", { outDir: embeddedDir } as unknown);

  // Only stop esbuild if not in test mode with global initialization
  if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
    try {
      esbuild.stop();
    } catch (_) {
      /* expected: esbuild service may not be running */
    }
  }

  return { manifest };
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

async function findOrCreateEntryPath(
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
): Promise<string> {
  const candidates = [
    join(projectDir, "app", "page.mdx"),
    join(projectDir, "app", "page.md"),
    join(projectDir, "pages", "index.mdx"),
    join(projectDir, "pages", "index.md"),
  ];

  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isFile) return c;
    } catch (error) {
      logger.debug(`Entry path not found: ${c}`, error);
    }
  }

  const entryPath = join(projectDir, ".veryfront", "__embedded_fallback__.tsx");
  await fs.mkdir(join(projectDir, ".veryfront"), { recursive: true });
  await fs.writeTextFile(
    entryPath,
    `export default function Page(){ return '<div>Veryfront</div>'; }`,
  );
  return entryPath;
}

async function bundleEmbeddedApp(params: {
  fs: ReturnType<typeof createFileSystem>;
  entryPath: string;
  projectDir: string;
  adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
}): Promise<string> {
  const { fs, entryPath, projectDir, adapter } = params;

  try {
    let sourceCode = await fs.readTextFile(entryPath);
    const isMdx = entryPath.endsWith(".mdx") || entryPath.endsWith(".md");

    if (isMdx) {
      const compiled = await compileMDXToJS(entryPath, sourceCode, {
        projectDir,
        mode: "production",
        adapter,
      });
      sourceCode = compiled.code;
    }

    const appBuild = await esbuild.build({
      stdin: {
        contents: sourceCode,
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
      external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    });

    const code = appBuild.outputFiles?.[0]?.text;
    if (code) return code;

    throw toError(
      createError({
        type: "build",
        message: "Failed to generate embedded app bundle: no output files",
      }),
    );
  } catch (error) {
    logger.error("Failed to bundle embedded app:", error);
    throw toError(
      createError({
        type: "build",
        message: `Failed to bundle embedded app: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    );
  }
}

async function discoverAppRoutes(
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
  embeddedDir: string,
): Promise<Array<{ routePath: string; filePath: string; sourcePath: string }>> {
  const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
  const base = join(projectDir, "app");

  async function walk(dir: string, rel = ""): Promise<void> {
    for await (const ent of fs.readDir(dir)) {
      const abs = join(dir, ent.name);
      const relNext = rel ? `${rel}/${ent.name}` : ent.name;

      if (ent.isDirectory) {
        await walk(abs, relNext);
        continue;
      }

      if (!ent.isFile || (ent.name !== "page.mdx" && ent.name !== "page.md")) continue;

      const routePath = rel.replace(/\/page\.(mdx|md)$/, "").replace(/(^$)/, "/");
      const norm = routePath === "" ? "/" : routePath.startsWith("/") ? routePath : `/${routePath}`;

      const filePath = join(embeddedDir, routePath === "" ? "app.js" : `app${norm}.js`);
      results.push({ routePath: norm, filePath, sourcePath: abs });
    }
  }

  try {
    await walk(base);
  } catch (_) {
    /* expected: no app directory */
  }

  return results;
}

async function discoverPagesRoutes(
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
  embeddedDir: string,
): Promise<Array<{ routePath: string; filePath: string; sourcePath: string }>> {
  const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
  const base = join(projectDir, "pages");

  async function walk(dir: string, rel = ""): Promise<void> {
    for await (const ent of fs.readDir(dir)) {
      const abs = join(dir, ent.name);
      const relNext = rel ? `${rel}/${ent.name}` : ent.name;

      if (ent.isDirectory) {
        await walk(abs, relNext);
        continue;
      }

      if (!ent.isFile) continue;
      if (!ent.name.endsWith(".mdx") && !ent.name.endsWith(".md")) continue;
      if (ent.name.startsWith("_")) continue;

      const withoutExt = relNext.replace(/\.(mdx|md)$/, "");
      const norm = `/${withoutExt}`;
      const routePath = norm.replace(/\/+/g, "/") ? norm.replace(/\/+/g, "/") : "/";
      const filePath = join(embeddedDir, `pages${routePath}.js`.replace(/\/+/g, "/"));
      results.push({ routePath, filePath, sourcePath: abs });
    }
  }

  try {
    await walk(base);
  } catch (_) {
    /* expected: no pages directory */
  }

  return results;
}
