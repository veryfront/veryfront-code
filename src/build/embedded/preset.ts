import { bundlerLogger as logger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors";
import * as esbuild from "veryfront/extensions/bundler";
import { join } from "#veryfront/compat/path/index.ts";
import { compileMDXToJS } from "../compiler/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";

export interface BuildEmbeddedOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
  config?: VeryfrontConfig;
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
  let buildResult: { manifest: EmbeddedBundleManifest } | undefined;
  let buildFailed = false;
  let buildError: unknown;

  try {
    const { projectDir, outDir } = options;
    const embeddedDir = join(outDir, "embedded");
    const fs = createFileSystem();
    const adapter = await runtime.get();
    const config = options.config ?? await getConfig(projectDir, adapter);
    const appDirectory = config.directories?.app ?? "app";
    const pagesDirectory = config.directories?.pages ?? "pages";

    await fs.mkdir(embeddedDir, { recursive: true });
    await fs.mkdir(join(embeddedDir, "rsc"), { recursive: true });

    const entryPath = await findOrCreateEntryPath(
      fs,
      projectDir,
      appDirectory,
      pagesDirectory,
    );
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
      ...(await discoverAppRoutes(fs, projectDir, embeddedDir, appDirectory)),
      ...(await discoverPagesRoutes(fs, projectDir, embeddedDir, pagesDirectory)),
    ];

    for (const r of discovered) {
      try {
        const mdxContent = await fs.readTextFile(r.sourcePath);
        const compiled = await compileMDXToJS(r.sourcePath, mdxContent, {
          projectDir,
          mode: "production",
          adapter,
        });

        await fs.mkdir(presetDirname(r.filePath), { recursive: true });
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
        const name = presetBasename(srcPath).replace(/\.tsx?$/, ".js");
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

    buildResult = { manifest };
  } catch (error) {
    buildFailed = true;
    buildError = error;
  }

  let stopFailed = false;
  let stopError: unknown;
  try {
    await esbuild.stop();
  } catch (error) {
    stopFailed = true;
    stopError = error;
  }

  if (buildFailed) {
    if (stopFailed) {
      logger.warn("Failed to stop esbuild after embedded preset build error", {
        error: String(stopError),
      } as unknown);
    }
    throw buildError;
  }

  if (stopFailed) throw stopError;
  return buildResult!;
}

/** @internal — exported for testing */
export function presetDirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** @internal — exported for testing */
export function presetBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** @internal — exported for testing */
export function normalizeAppRoutePath(rel: string): string {
  return rel === "" ? "/" : rel.startsWith("/") ? rel : `/${rel}`;
}

/** @internal — exported for testing */
export function normalizePageRoutePath(relPath: string): string {
  const withoutExt = relPath.replace(/\.(mdx|md)$/, "");
  const norm = `/${withoutExt}`;
  return norm.replace(/\/+/g, "/") || "/";
}

/** @internal — exported for testing */
export function isPageFile(name: string): boolean {
  return (name.endsWith(".mdx") || name.endsWith(".md")) && !name.startsWith("_");
}

async function findOrCreateEntryPath(
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
  appDirectory: string,
  pagesDirectory: string,
): Promise<string> {
  const candidates = [
    join(projectDir, appDirectory, "page.mdx"),
    join(projectDir, appDirectory, "page.md"),
    join(projectDir, pagesDirectory, "index.mdx"),
    join(projectDir, pagesDirectory, "index.md"),
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
  appDirectory: string,
): Promise<Array<{ routePath: string; filePath: string; sourcePath: string }>> {
  const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
  const base = join(projectDir, appDirectory);

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
      const norm = normalizeAppRoutePath(routePath);

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
  pagesDirectory: string,
): Promise<Array<{ routePath: string; filePath: string; sourcePath: string }>> {
  const results: Array<{ routePath: string; filePath: string; sourcePath: string }> = [];
  const base = join(projectDir, pagesDirectory);

  async function walk(dir: string, rel = ""): Promise<void> {
    for await (const ent of fs.readDir(dir)) {
      const abs = join(dir, ent.name);
      const relNext = rel ? `${rel}/${ent.name}` : ent.name;

      if (ent.isDirectory) {
        await walk(abs, relNext);
        continue;
      }

      if (!ent.isFile) continue;
      if (!isPageFile(ent.name)) continue;

      const routePath = normalizePageRoutePath(relNext);
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
