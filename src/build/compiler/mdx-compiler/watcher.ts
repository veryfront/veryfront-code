import { bundlerLogger as logger } from "#veryfront/utils";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { CompileOptions } from "./types.ts";
import { compileMDXFile } from "./compiler.ts";
import { getMDXSourceDirectories, validateCompileOptions } from "./validator.ts";

function isContainedPath(basePath: string, candidatePath: string): boolean {
  const pathFromBase = relative(basePath, candidatePath);
  return pathFromBase === "" ||
    (pathFromBase.split(/[\\/]/)[0] !== ".." && !isAbsolute(pathFromBase));
}

async function canonicalPath(fs: FileSystemAdapter, path: string): Promise<string> {
  return fs.realPath ? await fs.realPath(path) : resolve(path);
}

/** Recompile contained `.mdx` files until the watcher closes or its signal aborts. */
export async function watchMDX(options: CompileOptions): Promise<void> {
  validateCompileOptions(options);
  logger.info("Watching for MDX file changes...");

  const { fs } = await runtime.get();
  const projectDir = resolve(options.projectDir);
  const canonicalProjectDir = await canonicalPath(fs, projectDir);
  const dirsToWatch = await getWatchableDirectories(
    fs,
    projectDir,
    canonicalProjectDir,
    getMDXSourceDirectories(options),
  );
  if (dirsToWatch.length === 0) {
    logger.warn("No MDX directories found to watch");
    return;
  }

  const watcher = fs.watch(dirsToWatch, { recursive: true, signal: options.signal });

  try {
    for await (const event of watcher) {
      if (event.kind !== "modify" && event.kind !== "create") continue;
      await handleFileChange(
        fs,
        event.paths,
        options,
        projectDir,
        canonicalProjectDir,
        dirsToWatch,
      );
    }
  } finally {
    watcher.close();
    await watcher.done;
  }
}

async function getWatchableDirectories(
  fs: FileSystemAdapter,
  projectDir: string,
  canonicalProjectDir: string,
  sourceDirectories: readonly string[],
): Promise<string[]> {
  const dirsToWatch: string[] = [];
  for (const sourceDirectory of sourceDirectories) {
    const dir = join(projectDir, sourceDirectory);
    try {
      const stat = fs.lstat ? await fs.lstat(dir) : await fs.stat(dir);
      if (stat.isSymlink) {
        throw new TypeError("MDX source directories must not be symbolic links");
      }
      if (!stat.isDirectory) {
        throw new TypeError("MDX source paths must be directories");
      }
      const canonicalDirectory = await canonicalPath(fs, dir);
      if (!isContainedPath(canonicalProjectDir, canonicalDirectory)) {
        throw new TypeError("MDX source directory is outside the project directory");
      }
      dirsToWatch.push(dir);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  return dirsToWatch;
}

async function handleFileChange(
  fs: FileSystemAdapter,
  paths: string[],
  options: CompileOptions,
  projectDir: string,
  canonicalProjectDir: string,
  watchedDirectories: readonly string[],
): Promise<void> {
  for (const path of paths) {
    if (options.signal?.aborted) return;
    const sourcePath = resolve(projectDir, path);
    const projectRelativePath = relative(projectDir, sourcePath).replaceAll("\\", "/");
    if (
      !/\.mdx$/i.test(sourcePath) || !projectRelativePath ||
      !isContainedPath(projectDir, sourcePath) ||
      !watchedDirectories.some((directory) => isContainedPath(directory, sourcePath))
    ) continue;

    try {
      const fileInfo = fs.lstat ? await fs.lstat(sourcePath) : await fs.stat(sourcePath);
      if (fileInfo.isSymlink || !fileInfo.isFile) continue;
      const canonicalSourcePath = await canonicalPath(fs, sourcePath);
      if (!isContainedPath(canonicalProjectDir, canonicalSourcePath)) {
        throw new TypeError("Changed MDX source is outside the project directory");
      }
      const content = await fs.readFile(sourcePath);
      await compileMDXFile(sourcePath, content, options);
      logger.info("Recompiled MDX source", { sourcePath: projectRelativePath });
    } catch (error) {
      if (isNotFoundError(error)) continue;
      logger.error("Failed to recompile MDX source", { sourcePath: projectRelativePath });
    }
  }
}
