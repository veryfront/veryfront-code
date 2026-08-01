import { bundlerLogger as logger } from "#veryfront/utils";
import { BUILD_FAILED, SECURITY_VIOLATION } from "#veryfront/errors";
import * as esbuild from "veryfront/extensions/bundler";
import type {
  OnLoadArgs,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
  PluginBuild,
} from "veryfront/extensions/bundler";
import { dirname, isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import { compileMDXProgram, compileMDXToJS } from "../compiler/mdx-to-js.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
  realPath,
} from "#veryfront/platform/compat/fs.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import {
  CLIENT_DOM_BUNDLE,
  HYDRATE_CLIENT_BUNDLE,
} from "#veryfront/rendering/rsc/rsc-bundles.generated.ts";
import {
  createBuildPublication,
  ensureOwnedBuildDescendant,
  resolveBuildOutputOwnership,
} from "../production-build/build/build-publication.ts";
import { assertSafeBuildOutputDirectory } from "../production-build/build/output-plan.ts";
import {
  isContainedBuildPath,
  isNodeModulesPath,
  resolveProjectModule,
} from "../bundler/project-module-resolver.ts";

const MAX_PATH_CHARACTERS = 4_096;
const MAX_ROUTE_ENTRIES = 100_000;
const MAX_ROUTE_DEPTH = 64;
const REACT_EXTERNALS = [
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
] as const;

export interface BuildEmbeddedOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
  config?: VeryfrontConfig;
}

interface EmbeddedSource {
  sourcePath: string;
  content?: string;
}

interface DiscoveredRoute extends EmbeddedSource {
  routePath: string;
  outputRelativePath: string;
}

interface PlannedRoute extends EmbeddedSource {
  routePath: string;
  outputRelativePath: string;
}

interface DiscoveryBudget {
  entries: number;
}

function buildError(detail: string, cause?: unknown): Error {
  return BUILD_FAILED.create({ detail, cause });
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function validatePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_PATH_CHARACTERS || hasControlCharacters(value)) {
    throw new TypeError(`${name} must be a safe filesystem path`);
  }
}

function validateEmbeddedOptions(options: BuildEmbeddedOptions): void {
  if (!options || typeof options !== "object") {
    throw new TypeError("Embedded build options must be an object");
  }
  validatePath(options.projectDir, "Embedded projectDir");
  validatePath(options.outDir, "Embedded outDir");
  if (
    options.runtime !== "deno" &&
    options.runtime !== "node" &&
    options.runtime !== "bun"
  ) {
    throw new TypeError('Embedded runtime must be "deno", "node", or "bun"');
  }
}

async function canonicalTargetPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    return await realPath(absolutePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const unresolved: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      throw buildError(`Cannot resolve an existing ancestor for ${path}`);
    }
    unresolved.unshift(presetBasename(current));
    try {
      return resolve(await realPath(parent), ...unresolved);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      current = parent;
    }
  }
}

function validateConfiguredDirectory(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const directory = value ?? fallback;
  validatePath(directory, name);
  if (
    isAbsolute(directory) ||
    directory.includes("\\") ||
    directory.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${name} must be a canonical project-relative path`);
  }
  return directory;
}

async function assertProjectDirectory(path: string, fs: FileSystem): Promise<void> {
  let info;
  try {
    info = await fs.stat(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw buildError(`Embedded project directory does not exist: ${path}`);
    }
    throw error;
  }
  if (!info.isDirectory) {
    throw buildError(`Embedded project path is not a directory: ${path}`);
  }
}

async function assertConfiguredSourceDirectory(
  projectDir: string,
  directory: string,
): Promise<void> {
  const [canonicalProject, canonicalDirectory] = await Promise.all([
    canonicalTargetPath(projectDir),
    canonicalTargetPath(join(projectDir, directory)),
  ]);
  if (!isContainedBuildPath(canonicalProject, canonicalDirectory)) {
    throw SECURITY_VIOLATION.create({
      detail: `Embedded source directory resolves outside the project: ${directory}`,
    });
  }
}

/**
 * Build a complete embedded bundle and publish it atomically at
 * `<outDir>/embedded`.
 */
export async function buildEmbeddedPreset(
  options: BuildEmbeddedOptions,
): Promise<{ manifest: EmbeddedBundleManifest }> {
  validateEmbeddedOptions(options);

  let result: { manifest: EmbeddedBundleManifest } | undefined;
  let buildFailure: unknown;
  try {
    result = await executeEmbeddedBuild(options);
  } catch (error) {
    buildFailure = error;
  }

  let stopFailure: unknown;
  try {
    await esbuild.stop();
  } catch (error) {
    stopFailure = error;
  }

  if (buildFailure !== undefined) {
    if (stopFailure !== undefined) {
      throw new AggregateError(
        [buildFailure, stopFailure],
        "Embedded build failed and the bundler could not stop cleanly",
      );
    }
    throw buildFailure;
  }
  if (stopFailure !== undefined) throw stopFailure;
  if (!result) throw buildError("Embedded build completed without a result");
  return result;
}

async function executeEmbeddedBuild(
  options: BuildEmbeddedOptions,
): Promise<{ manifest: EmbeddedBundleManifest }> {
  const projectDir = resolve(options.projectDir);
  const outDir = resolve(options.outDir);
  const embeddedDir = join(outDir, "embedded");
  const fs = createFileSystem();
  const adapter = await runtime.get();

  await assertProjectDirectory(projectDir, fs);
  const config = options.config ?? await getConfig(projectDir, adapter);
  const appDirectory = validateConfiguredDirectory(
    config.directories?.app,
    "app",
    "Embedded app directory",
  );
  const pagesDirectory = validateConfiguredDirectory(
    config.directories?.pages,
    "pages",
    "Embedded pages directory",
  );
  await Promise.all([
    assertConfiguredSourceDirectory(projectDir, appDirectory),
    assertConfiguredSourceDirectory(projectDir, pagesDirectory),
  ]);
  await assertSafeBuildOutputDirectory(projectDir, embeddedDir, {
    ...config,
    directories: {
      ...config.directories,
      app: appDirectory,
      pages: pagesDirectory,
    },
  });

  const publication = await createBuildPublication(embeddedDir, false, { fs });
  if (publication.dryRun) {
    throw buildError("Embedded publication unexpectedly entered dry-run mode");
  }
  let manifest: EmbeddedBundleManifest | undefined;
  let operationFailure: unknown;

  try {
    const stagingDir = resolveBuildOutputOwnership(publication.outputOwnership, fs);
    const rscDir = await ensureOwnedBuildDescendant(
      publication.outputOwnership,
      fs,
      "rsc",
    );

    const entry = await findEmbeddedEntry(
      fs,
      projectDir,
      appDirectory,
      pagesDirectory,
    );
    const budget: DiscoveryBudget = { entries: 0 };
    const discovered = [
      ...(await discoverAppRoutes(fs, projectDir, appDirectory, budget)),
      ...(await discoverPagesRoutes(fs, projectDir, pagesDirectory, budget)),
    ];
    const plannedRoutes = planRoutes(entry, discovered);
    const bundleCache = new Map<string, Promise<string>>();

    for (const route of plannedRoutes) {
      const cacheKey = route.content === undefined
        ? route.sourcePath
        : `${route.sourcePath}\0${route.content}`;
      let bundle = bundleCache.get(cacheKey);
      if (!bundle) {
        bundle = bundleEmbeddedModule({
          source: route,
          projectDir,
          runtimeTarget: options.runtime,
          adapter,
          fs,
        });
        bundleCache.set(cacheKey, bundle);
      }

      const portableOutputPath = route.outputRelativePath.replaceAll("\\", "/");
      const relativeParent = dirname(portableOutputPath);
      const outputParent = relativeParent === "." ? stagingDir : await ensureOwnedBuildDescendant(
        publication.outputOwnership,
        fs,
        relativeParent,
      );
      const outputPath = join(outputParent, presetBasename(portableOutputPath));
      await fs.writeTextFile(outputPath, await bundle);
    }

    await Promise.all([
      fs.writeTextFile(join(rscDir, "client-dom.js"), CLIENT_DOM_BUNDLE),
      fs.writeTextFile(
        join(rscDir, "hydrate-client.js"),
        HYDRATE_CLIENT_BUNDLE,
      ),
    ]);

    manifest = {
      version: 1,
      routes: plannedRoutes.map((route) => ({
        path: route.routePath,
        file: `embedded/${route.outputRelativePath.replaceAll("\\", "/")}`,
        type: "page" as const,
      })),
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
      join(stagingDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await publication.publish();
  } catch (error) {
    operationFailure = error;
  }

  let cleanupFailure: unknown;
  try {
    await publication.cleanup();
  } catch (error) {
    cleanupFailure = error;
  }

  if (operationFailure !== undefined) {
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [operationFailure, cleanupFailure],
        "Embedded build failed and its staging output could not be cleaned up",
      );
    }
    throw operationFailure;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (!manifest) throw buildError("Embedded build did not produce a manifest");

  logger.info("Embedded preset built", { outDir: embeddedDir } as unknown);
  return { manifest };
}

function validateRoutePath(routePath: string): void {
  if (
    routePath.length === 0 ||
    routePath.length > MAX_PATH_CHARACTERS ||
    !routePath.startsWith("/") ||
    routePath.includes("\\") ||
    routePath.includes("?") ||
    routePath.includes("#") ||
    hasControlCharacters(routePath) ||
    (routePath !== "/" &&
      routePath.split("/").some((segment, index) =>
        index > 0 && (segment === "" || segment === "." || segment === "..")
      ))
  ) {
    throw buildError(`Invalid embedded route path: ${JSON.stringify(routePath)}`);
  }
}

function validateOutputRelativePath(outputPath: string): void {
  if (
    outputPath.length === 0 ||
    outputPath.length > MAX_PATH_CHARACTERS ||
    isAbsolute(outputPath) ||
    outputPath.includes("\\") ||
    outputPath.includes("?") ||
    outputPath.includes("#") ||
    hasControlCharacters(outputPath) ||
    outputPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw buildError(`Invalid embedded output path: ${JSON.stringify(outputPath)}`);
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function planRoutes(
  entry: EmbeddedSource,
  discovered: readonly DiscoveredRoute[],
): PlannedRoute[] {
  const planned: PlannedRoute[] = [{
    ...entry,
    routePath: "/",
    outputRelativePath: "app.js",
  }];
  const routePaths = new Set<string>(["/"]);
  const outputPaths = new Map<string, string>([["app.js", "/"]]);

  for (const route of discovered) {
    validateRoutePath(route.routePath);
    validateOutputRelativePath(route.outputRelativePath);

    if (route.routePath === "/" && samePath(route.sourcePath, entry.sourcePath)) {
      continue;
    }
    if (routePaths.has(route.routePath)) {
      throw buildError(`Duplicate embedded route: ${route.routePath}`);
    }

    const outputKey = route.outputRelativePath.normalize("NFC").toLocaleLowerCase("en-US");
    const existingRoute = outputPaths.get(outputKey);
    if (existingRoute) {
      throw buildError(
        `Embedded output collision between routes ${existingRoute} and ${route.routePath}`,
      );
    }

    routePaths.add(route.routePath);
    outputPaths.set(outputKey, route.routePath);
    planned.push(route);
  }
  return planned;
}

async function findEmbeddedEntry(
  fs: FileSystem,
  projectDir: string,
  appDirectory: string,
  pagesDirectory: string,
): Promise<EmbeddedSource> {
  const candidates = [
    join(projectDir, appDirectory, "page.mdx"),
    join(projectDir, appDirectory, "page.md"),
    join(projectDir, pagesDirectory, "index.mdx"),
    join(projectDir, pagesDirectory, "index.md"),
  ];

  for (const candidate of candidates) {
    try {
      const lstat = fs.lstat ? await fs.lstat(candidate) : undefined;
      if (lstat?.isSymlink) {
        throw SECURITY_VIOLATION.create({
          detail: `Embedded entry must not be a symbolic link: ${candidate}`,
        });
      }
      const stat = await fs.stat(candidate);
      if (!stat.isFile) {
        throw buildError(`Embedded entry candidate is not a file: ${candidate}`);
      }
      return { sourcePath: candidate };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  return {
    sourcePath: join(projectDir, ".veryfront", "__embedded_fallback__.mdx"),
    content: "# Veryfront",
  };
}

function assertSafeEntryName(name: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_PATH_CHARACTERS ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    hasControlCharacters(name)
  ) {
    throw buildError("Embedded route discovery received an invalid directory entry");
  }
}

async function readSortedEntries(fs: FileSystem, directory: string) {
  const entries: Array<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }> = [];
  for await (const entry of fs.readDir(directory)) {
    assertSafeEntryName(entry.name);
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
}

async function directoryExists(fs: FileSystem, path: string): Promise<boolean> {
  try {
    const info = await fs.stat(path);
    if (!info.isDirectory) {
      throw buildError(`Embedded route source is not a directory: ${path}`);
    }
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function discoverRoutes(
  fs: FileSystem,
  base: string,
  kind: "app" | "pages",
  budget: DiscoveryBudget,
): Promise<DiscoveredRoute[]> {
  if (!(await directoryExists(fs, base))) return [];
  const results: DiscoveredRoute[] = [];

  async function walk(directory: string, relativeDirectory: string, depth: number): Promise<void> {
    if (depth > MAX_ROUTE_DEPTH) {
      throw buildError(`Embedded route depth exceeds ${MAX_ROUTE_DEPTH}`);
    }

    for (const entry of await readSortedEntries(fs, directory)) {
      budget.entries++;
      if (budget.entries > MAX_ROUTE_ENTRIES) {
        throw buildError(`Embedded route discovery exceeds ${MAX_ROUTE_ENTRIES} entries`);
      }
      if (entry.isSymlink) {
        throw SECURITY_VIOLATION.create({
          detail: `Embedded route discovery does not follow symbolic links: ${
            join(directory, entry.name)
          }`,
        });
      }

      const absolutePath = join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(absolutePath, relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;

      if (kind === "app") {
        if (entry.name !== "page.mdx" && entry.name !== "page.md") continue;
        const routePath = normalizeAppRoutePath(relativeDirectory);
        const outputRelativePath = routePath === "/" ? "app.js" : `app${routePath}.js`;
        results.push({
          routePath,
          outputRelativePath,
          sourcePath: absolutePath,
        });
        continue;
      }

      if (!isPageFile(entry.name)) continue;
      const routePath = normalizePageRoutePath(relativePath);
      const withoutExtension = relativePath.replace(/\.(?:mdx|md)$/i, "");
      results.push({
        routePath,
        outputRelativePath: `pages/${withoutExtension}.js`,
        sourcePath: absolutePath,
      });
    }
  }

  await walk(base, "", 0);
  return results;
}

async function discoverAppRoutes(
  fs: FileSystem,
  projectDir: string,
  appDirectory: string,
  budget: DiscoveryBudget,
): Promise<DiscoveredRoute[]> {
  return await discoverRoutes(fs, join(projectDir, appDirectory), "app", budget);
}

async function discoverPagesRoutes(
  fs: FileSystem,
  projectDir: string,
  pagesDirectory: string,
  budget: DiscoveryBudget,
): Promise<DiscoveredRoute[]> {
  return await discoverRoutes(fs, join(projectDir, pagesDirectory), "pages", budget);
}

function createEmbeddedProjectPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  fs: FileSystem,
  runtimeTarget: BuildEmbeddedOptions["runtime"],
): Plugin {
  return {
    name: "veryfront-embedded-project",
    setup(build: PluginBuild): void {
      build.onResolve({ filter: /.*/ }, async (args: OnResolveArgs) => {
        if (
          args.path.startsWith("http://") ||
          args.path.startsWith("https://")
        ) {
          if (runtimeTarget !== "deno") {
            throw buildError(
              `Remote module imports are not supported by the ${runtimeTarget} embedded target`,
            );
          }
          return { path: args.path, external: true };
        }

        if (
          args.path.startsWith(".") &&
          !isContainedBuildPath(projectDir, resolve(args.resolveDir)) &&
          isNodeModulesPath(args.resolveDir)
        ) {
          // Bare dependencies are resolved by the bundler. Their own relative
          // imports may live in a workspace-level/hoisted node_modules tree.
          return null;
        }

        const resolved = await resolveProjectModule(
          args.path,
          args.resolveDir,
          projectDir,
          fs,
          "Embedded",
        );
        if (!resolved) return null;
        return {
          path: resolved.path,
          ...(resolved.suffix ? { suffix: resolved.suffix } : {}),
        } as OnResolveResult;
      });

      build.onLoad(
        { filter: /\.mdx?$/i },
        async (args: OnLoadArgs) => {
          const content = await fs.readTextFile(args.path);
          const compiled = await compileMDXProgram(args.path, content, {
            projectDir,
            mode: "production",
            adapter,
          });
          return {
            contents: compiled.code,
            loader: "js",
            resolveDir: dirname(args.path),
          };
        },
      );
    },
  };
}

function runtimeBuildSettings(runtimeTarget: BuildEmbeddedOptions["runtime"]): {
  platform: "neutral" | "node";
  target: string[];
} {
  switch (runtimeTarget) {
    case "node":
      return { platform: "node", target: ["node20"] };
    case "bun":
      return { platform: "node", target: ["es2022"] };
    case "deno":
      return { platform: "neutral", target: ["es2022"] };
  }
}

async function bundleEmbeddedModule(params: {
  source: EmbeddedSource;
  projectDir: string;
  runtimeTarget: BuildEmbeddedOptions["runtime"];
  adapter: RuntimeAdapter;
  fs: FileSystem;
}): Promise<string> {
  const { source, projectDir, runtimeTarget, adapter, fs } = params;
  const sourceCode = source.content ?? await fs.readTextFile(source.sourcePath);
  const isMdx = /\.mdx?$/i.test(source.sourcePath);
  const compiledCode = isMdx
    ? (await compileMDXToJS(source.sourcePath, sourceCode, {
      projectDir,
      mode: "production",
      adapter,
    })).code
    : sourceCode;
  const settings = runtimeBuildSettings(runtimeTarget);

  try {
    const result = await esbuild.build({
      stdin: {
        contents: compiledCode,
        sourcefile: source.sourcePath,
        resolveDir: dirname(source.sourcePath),
        loader: "js",
      },
      bundle: true,
      format: "esm",
      platform: settings.platform,
      target: settings.target,
      minify: true,
      treeShaking: true,
      write: false,
      logLevel: "silent",
      external: [...REACT_EXTERNALS, "node:*"],
      plugins: [
        createEmbeddedProjectPlugin(
          projectDir,
          adapter,
          fs,
          runtimeTarget,
        ),
      ],
    });

    if (result.errors.length > 0) {
      throw buildError(
        `Embedded bundler reported ${result.errors.length} error${
          result.errors.length === 1 ? "" : "s"
        }`,
      );
    }
    if (result.outputFiles.length !== 1) {
      throw buildError(
        "Embedded page produced additional assets; import CSS and binary assets through the public asset pipeline",
      );
    }
    const code = result.outputFiles[0]?.text;
    if (!code) throw buildError("Embedded page bundle produced no JavaScript");
    return code;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw buildError(
      `Failed to bundle embedded module ${source.sourcePath}: ${detail}`,
      error,
    );
  }
}

/** @internal — exported for compatibility and focused tests. */
export function presetDirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** @internal — exported for compatibility and focused tests. */
export function presetBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** @internal — exported for compatibility and focused tests. */
export function normalizeAppRoutePath(relativeDirectory: string): string {
  return relativeDirectory === ""
    ? "/"
    : relativeDirectory.startsWith("/")
    ? relativeDirectory
    : `/${relativeDirectory}`;
}

/** @internal — exported for compatibility and focused tests. */
export function normalizePageRoutePath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.(mdx|md)$/i, "");
  const normalized = `/${withoutExtension}`;
  return normalized.replace(/\/+/g, "/") || "/";
}

/** @internal — exported for compatibility and focused tests. */
export function isPageFile(name: string): boolean {
  return /\.(?:mdx|md)$/i.test(name) && !name.startsWith("_");
}
