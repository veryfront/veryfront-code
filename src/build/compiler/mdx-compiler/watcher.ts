import { bundlerLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileChangeEvent } from "#veryfront/platform/adapters/base.ts";
import type { CompileOptions } from "./types.ts";
import { compileMDXFile } from "./compiler.ts";
import { getCompiledOutputPath } from "./file-writer.ts";
import { validateCompileOptions } from "./validator.ts";

export async function watchMDX(options: CompileOptions): Promise<void> {
  validateCompileOptions(options);
  options.signal?.throwIfAborted();
  logger.info("Watching for MDX file changes...");

  const dirsToWatch = await getWatchableDirectories(options.projectDir);
  if (dirsToWatch.length === 0) {
    logger.warn("No MDX directories found to watch");
    return;
  }

  const { fs } = await runtime.get();
  const watcher = fs.watch(dirsToWatch, {
    recursive: true,
    signal: options.signal,
  });

  let watchError: unknown;
  try {
    await watcher.ready;
    for await (const event of watcher) {
      await processMDXWatchEvent(event, options);
    }
  } catch (error) {
    watchError = error;
  }

  let cleanupError: unknown;
  try {
    watcher.close();
    await watcher.done;
  } catch (error) {
    cleanupError = error;
  }

  if (watchError !== undefined) {
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [watchError, cleanupError],
        "MDX watcher failed and could not close cleanly",
      );
    }
    throw watchError;
  }
  if (cleanupError !== undefined) throw cleanupError;
}

async function getWatchableDirectories(projectDir: string): Promise<string[]> {
  const { fs } = await runtime.get();
  const potentialDirs = ["pages", "layouts", "providers"].map((dir) => join(projectDir, dir));

  const dirsToWatch: string[] = [];
  for (const dir of potentialDirs) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory) dirsToWatch.push(dir);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      continue;
    }
  }

  return dirsToWatch;
}

export async function processMDXWatchEvent(
  event: FileChangeEvent,
  options: CompileOptions,
): Promise<void> {
  if (
    event.kind !== "modify" &&
    event.kind !== "create" &&
    event.kind !== "delete" &&
    event.kind !== "any"
  ) {
    return;
  }

  const { fs } = await runtime.get();
  const outputFs = createFileSystem();

  for (const path of event.paths) {
    options.signal?.throwIfAborted();
    if (!/\.mdx$/i.test(path)) continue;

    const removeCompiledOutput = async (): Promise<void> => {
      const outputPath = await getCompiledOutputPath(path, options);
      try {
        await outputFs.remove(outputPath);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    };

    if (event.kind === "delete") {
      await removeCompiledOutput();
      logger.info(`Removed compiled output for: ${path}`);
      continue;
    }

    try {
      const content = await fs.readFile(path);
      await compileMDXFile(path, content, options);
      logger.info(`Recompiled: ${path}`);
    } catch (error) {
      if (isNotFoundError(error)) {
        await removeCompiledOutput();
        logger.info(`Removed compiled output for: ${path}`);
        continue;
      }
      try {
        await removeCompiledOutput();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to recompile ${path} and remove its stale output`,
        );
      }
      logger.error(`Failed to recompile ${path}:`, error);
    }
  }
}
