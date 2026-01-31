import { bundlerLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { CompileOptions } from "./types.ts";
import { compileMDXFile } from "./compiler.ts";

export async function watchMDX(options: CompileOptions): Promise<void> {
  logger.info("Watching for MDX file changes...");

  const dirsToWatch = await getWatchableDirectories(options.projectDir);
  if (dirsToWatch.length === 0) {
    logger.warn("No MDX directories found to watch");
    return;
  }

  const { fs } = await runtime.get();
  const watcher = fs.watch(dirsToWatch, { recursive: true });

  for await (const event of watcher) {
    if (event.kind !== "modify" && event.kind !== "create") continue;
    await handleFileChange(event.paths, options);
  }
}

async function getWatchableDirectories(projectDir: string): Promise<string[]> {
  const { fs } = await runtime.get();
  const potentialDirs = ["pages", "layouts", "providers"].map((dir) => join(projectDir, dir));

  const dirsToWatch: string[] = [];
  for (const dir of potentialDirs) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory) dirsToWatch.push(dir);
    } catch {
      continue;
    }
  }

  return dirsToWatch;
}

async function handleFileChange(paths: string[], options: CompileOptions): Promise<void> {
  const { fs } = await runtime.get();

  for (const path of paths) {
    if (!path.endsWith(".mdx")) continue;

    try {
      const content = await fs.readFile(path);
      await compileMDXFile(path, content, options);
      logger.info(`Recompiled: ${path}`);
    } catch (error) {
      logger.error(`Failed to recompile ${path}:`, error);
    }
  }
}
