import { bundlerLogger as logger } from "@veryfront/utils";
import { join } from "std/path/mod.ts";
import { getAdapter } from "../../../platform/adapters/detect.ts";
import type { CompileOptions } from "./types.ts";
import { compileMDXFile } from "./compiler.ts";

export async function watchMDX(options: CompileOptions): Promise<void> {
  logger.info("Watching for MDX file changes...");

  const dirsToWatch = await getWatchableDirectories(options.projectDir);

  if (dirsToWatch.length === 0) {
    logger.warn("No MDX directories found to watch");
    return;
  }

  const adapter = await getAdapter();
  const watcher = adapter.fs.watch(dirsToWatch, { recursive: true });

  for await (const event of watcher) {
    if (event.kind === "modify" || event.kind === "create") {
      await handleFileChange(event.paths, options);
    }
  }
}

async function getWatchableDirectories(projectDir: string): Promise<string[]> {
  const adapter = await getAdapter();
  const dirsToWatch: string[] = [];
  const potentialDirs = [
    join(projectDir, "pages"),
    join(projectDir, "layouts"),
    join(projectDir, "providers"),
  ];

  for (const dir of potentialDirs) {
    try {
      const stat = await adapter.fs.stat(dir);
      if (stat.isDirectory) {
        dirsToWatch.push(dir);
      }
    } catch {
    }
  }

  return dirsToWatch;
}

async function handleFileChange(paths: string[], options: CompileOptions): Promise<void> {
  const adapter = await getAdapter();
  for (const path of paths) {
    if (path.endsWith(".mdx")) {
      try {
        const content = await adapter.fs.readFile(path);
        await compileMDXFile(path, content, options);
        logger.info(`Recompiled: ${path}`);
      } catch (error) {
        logger.error(`Failed to recompile ${path}:`, error);
      }
    }
  }
}
