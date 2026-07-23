import { bundlerLogger as logger } from "#veryfront/utils";
import { BUILD_FAILED, createError, ensureError, toError } from "#veryfront/errors";
import * as esbuild from "veryfront/extensions/bundler";
import {
  basename,
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { compileMDXToJS } from "../compiler/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import {
  type BuildOutputTransaction,
  commitBuildOutput,
  createBuildOutputTransaction,
  rollbackBuildOutput,
} from "../production-build/build/build-setup.ts";

/** Options for producing an embedded runtime bundle. */
export interface BuildEmbeddedOptions {
  /** Project root containing configured app and pages directories. */
  projectDir: string;
  /** Parent directory that receives the transactional `embedded/` output. */
  outDir: string;
  /** Runtime target used by the generated bundle. */
  runtime: "deno" | "node" | "bun";
  /** Preloaded project config. Omit it to resolve config from `projectDir`. */
  config?: VeryfrontConfig;
}

/** Manifest returned after an embedded output transaction commits. */
export interface EmbeddedBuildResult {
  manifest: EmbeddedBundleManifest;
}

/**
 * Build and atomically commit an embedded preset bundle.
 * Outputs:
 * - outDir/embedded/manifest.json
 * - outDir/embedded/app.js (SSR entry)
 * - outDir/embedded/rsc/*.js (RSC support)
 */
export async function buildEmbeddedPreset(
  options: BuildEmbeddedOptions,
): Promise<EmbeddedBuildResult> {
  let buildResult: EmbeddedBuildResult | undefined;
  let buildFailed = false;
  let buildError: unknown;
  let outputTransaction: BuildOutputTransaction | null = null;

  try {
    if (!options.projectDir?.trim()) throw new TypeError("projectDir must not be blank");
    if (!options.outDir?.trim()) throw new TypeError("outDir must not be blank");
    if (options.runtime !== "deno" && options.runtime !== "node" && options.runtime !== "bun") {
      throw new TypeError(`Unsupported embedded runtime: ${String(options.runtime)}`);
    }

    const projectDir = resolve(options.projectDir);
    const outDir = resolve(options.outDir);
    outputTransaction = createBuildOutputTransaction(join(outDir, "embedded"), false);
    const embeddedDir = outputTransaction.workingOutputDir;
    const fs = createFileSystem();
    const adapter = await runtime.get();
    const config = options.config ?? await getConfig(projectDir, adapter);
    const appDirectory = config.directories?.app ?? "app";
    const pagesDirectory = config.directories?.pages ?? "pages";
    await assertProjectDirectory(fs, projectDir, appDirectory, "app");
    await assertProjectDirectory(fs, projectDir, pagesDirectory, "pages");

    await fs.mkdir(embeddedDir, { recursive: true });
    await fs.mkdir(join(embeddedDir, "rsc"), { recursive: true });

    const entryPath = await findEntryPath(
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
      adapter,
    });

    await fs.writeTextFile(appOut, bundledAppCode);

    const routes: Array<{ path: string; file: string; type: "page" | "api" }> = [];
    const discovered = [
      ...(await discoverAppRoutes(fs, projectDir, embeddedDir, appDirectory)),
      ...(await discoverPagesRoutes(fs, projectDir, embeddedDir, pagesDirectory)),
    ];

    const routePaths = new Set(["/"]);
    for (const r of discovered) {
      if (r.routePath === "/") continue;
      if (routePaths.has(r.routePath)) {
        throw new TypeError(`Duplicate embedded route path: ${r.routePath}`);
      }
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
        routePaths.add(r.routePath);
      } catch (error) {
        throw BUILD_FAILED.create({
          detail: `Failed to compile embedded route ${r.routePath}`,
          cause: error,
        });
      }
    }

    routes.unshift({ path: "/", file: "embedded/app.js", type: "page" });

    const rscFiles = [
      new URL("../../rendering/rsc/client-dom.ts", import.meta.url),
      new URL("../../rendering/rsc/hydrate-client.ts", import.meta.url),
    ];

    for (const url of rscFiles) {
      const srcPath = fromFileUrl(url);
      const src = await fs.readTextFile(srcPath);
      const res = await esbuild.transform(src, {
        loader: "ts",
        target: "es2020",
        format: "esm",
      });
      const name = basename(srcPath).replace(/\.tsx?$/, ".js");
      await fs.writeTextFile(join(embeddedDir, "rsc", name), res.code);
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

    logger.info("Embedded preset built");

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

  const failures: Error[] = [];
  if (buildFailed) failures.push(ensureError(buildError));
  if (stopFailed) failures.push(ensureError(stopError));

  if (failures.length > 0) {
    if (outputTransaction) {
      try {
        await rollbackBuildOutput(outputTransaction);
      } catch (error) {
        failures.push(ensureError(error));
      }
    }
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Embedded preset build and cleanup failed");
  }

  if (!buildResult) throw new Error("Embedded preset build completed without a result");
  if (!outputTransaction) throw new Error("Embedded preset build has no output transaction");

  try {
    await commitBuildOutput(outputTransaction);
  } catch (error) {
    const commitFailures = [ensureError(error)];
    try {
      await rollbackBuildOutput(outputTransaction);
    } catch (rollbackError) {
      commitFailures.push(ensureError(rollbackError));
    }
    if (commitFailures.length === 1) throw commitFailures[0];
    throw new AggregateError(commitFailures, "Embedded preset commit and rollback failed");
  }

  return buildResult;
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

async function assertProjectDirectory(
  fs: ReturnType<typeof createFileSystem>,
  projectDir: string,
  configuredPath: string,
  label: string,
): Promise<void> {
  if (!configuredPath.trim()) {
    throw new TypeError(`Embedded ${label} directory must not be blank`);
  }

  const sourceDir = resolve(projectDir, configuredPath);
  const projectRelativePath = relative(projectDir, sourceDir);
  if (projectRelativePath.split(/[\\/]/)[0] === ".." || isAbsolute(projectRelativePath)) {
    throw new TypeError(`Embedded ${label} directory is outside projectDir: ${configuredPath}`);
  }

  if (!fs.realPath) return;
  try {
    const [realProjectDir, realSourceDir] = await Promise.all([
      fs.realPath(projectDir),
      fs.realPath(sourceDir),
    ]);
    const realRelativePath = relative(realProjectDir, realSourceDir);
    if (realRelativePath.split(/[\\/]/)[0] === ".." || isAbsolute(realRelativePath)) {
      throw new TypeError(`Embedded ${label} directory is outside projectDir: ${configuredPath}`);
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function findEntryPath(
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
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw toError(
    createError({
      type: "build",
      message: "No embedded entry route found in the configured app or pages directory",
    }),
  );
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
    logger.error("Failed to bundle embedded app");
    throw BUILD_FAILED.create({
      detail: "Failed to bundle embedded app",
      cause: error,
    });
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
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
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
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  return results;
}
